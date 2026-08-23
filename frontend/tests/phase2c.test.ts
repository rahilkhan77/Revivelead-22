import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as razorpayWebhook } from "@/app/api/webhooks/razorpay/route";
import { AuthError } from "@/lib/errors";
import { loadAdminBilling } from "@/lib/admin/access";
import { createAgencyCheckout, resolveCheckoutIntent } from "@/lib/billing/checkout";
import { isRecognizedRazorpayEvent } from "@/lib/billing/events";
import { assertWithinLeadLimit, isUnpaidSubscription } from "@/lib/billing/plans";
import { applyRazorpaySubscription, limitsForSubscriptionStatus } from "@/lib/billing/razorpay";
import { confirmRazorpayCheckout } from "@/lib/billing/verify";
import { db } from "@/lib/db";
import { createAgency } from "./helpers";

const suffix = `p2c${Date.now()}`;

function asUser(
  agency: Awaited<ReturnType<typeof createAgency>>,
  who: "owner" | "agent",
) {
  const person = agency[who];
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    organizationId: agency.organization.id,
    organizationName: agency.organization.name,
    role: who === "owner" ? ("OWNER" as const) : ("SALES_AGENT" as const),
  };
}

function signWebhook(body: string, secret = "test_webhook_secret") {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("Phase 2C Razorpay billing", () => {
  let alpha: Awaited<ReturnType<typeof createAgency>>;
  let beta: Awaited<ReturnType<typeof createAgency>>;
  let adminEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    alpha = await createAgency(`alpha-${suffix}`);
    beta = await createAgency(`beta-${suffix}`);
    adminEnv = {
      ...process.env,
      REVIVELEAD_ADMIN_EMAILS: alpha.owner.email,
      REVIVELEAD_ADMIN_USER_IDS: "",
    };
  });

  afterAll(async () => {
    await db.webhookEvent.deleteMany({ where: { provider: "razorpay", eventId: { contains: suffix } } });
    await alpha.cleanup();
    await beta.cleanup();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects unauthorized checkout and ignores client amount, currency, and organizationId", () => {
    const owner = asUser(alpha, "owner");
    const agent = asUser(alpha, "agent");
    expect(resolveCheckoutIntent(agent, { plan: "PRO" }).ok).toBe(false);
    expect(resolveCheckoutIntent(owner, { plan: "ENTERPRISE" }).ok).toBe(false);
    expect(resolveCheckoutIntent(owner, { plan: "not-a-plan" }).ok).toBe(false);

    const tampered = resolveCheckoutIntent(owner, {
      plan: "STARTER",
      amount: 1,
      currency: "INR",
      organizationId: beta.organization.id,
    });
    expect(tampered).toMatchObject({
      ok: true,
      data: { plan: "STARTER", organizationId: alpha.organization.id },
    });
  });

  it("fails closed when Razorpay is not configured and never bills a non-owner", async () => {
    const previous = {
      RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
      RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
      PADDLE_API_KEY: process.env.PADDLE_API_KEY,
    };
    process.env.RAZORPAY_KEY_ID = "";
    process.env.RAZORPAY_KEY_SECRET = "";
    process.env.PADDLE_API_KEY = "";
    try {
      const missing = await createAgencyCheckout(asUser(alpha, "owner"), { plan: "PRO" });
      expect(missing.ok).toBe(false);
      expect(missing.error).toMatch(/not configured/i);
      const agent = await createAgencyCheckout(asUser(alpha, "agent"), { plan: "PRO" });
      expect(agent.ok).toBe(false);
    } finally {
      process.env.RAZORPAY_KEY_ID = previous.RAZORPAY_KEY_ID;
      process.env.RAZORPAY_KEY_SECRET = previous.RAZORPAY_KEY_SECRET;
      process.env.PADDLE_API_KEY = previous.PADDLE_API_KEY;
    }
  });

  it("activates only after a valid server-side signature and live snapshot", async () => {
    const subscriptionId = `sub_confirm_${suffix}`;
    await db.subscription.update({
      where: { organizationId: alpha.organization.id },
      data: { provider: "razorpay", providerSubId: subscriptionId },
    });
    const paymentId = "pay_confirm1";
    const secret = "checkout_secret";
    const signature = createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");

    const invalid = await confirmRazorpayCheckout({
      organizationId: alpha.organization.id,
      userId: alpha.owner.id,
      paymentId,
      subscriptionId,
      signature: "00".repeat(32),
      secret,
      liveSubscription: { id: subscriptionId, status: "active", plan_id: "plan_test_pro" },
    });
    expect(invalid.ok).toBe(false);

    const mismatch = await confirmRazorpayCheckout({
      organizationId: alpha.organization.id,
      userId: alpha.owner.id,
      paymentId,
      subscriptionId,
      signature,
      secret,
      liveSubscription: {
        id: subscriptionId,
        status: "active",
        plan_id: "plan_test_pro",
        notes: { organizationId: beta.organization.id },
      },
    });
    expect(mismatch.ok).toBe(false);

    const created = await confirmRazorpayCheckout({
      organizationId: alpha.organization.id,
      userId: alpha.owner.id,
      paymentId,
      subscriptionId,
      signature,
      secret,
      liveSubscription: {
        id: subscriptionId,
        status: "created",
        plan_id: "plan_test_pro",
        notes: { organizationId: alpha.organization.id },
      },
    });
    expect(created.ok).toBe(true);
    expect(created.data?.confirmed).toBe(false);

    const paid = await confirmRazorpayCheckout({
      organizationId: alpha.organization.id,
      userId: alpha.owner.id,
      paymentId,
      subscriptionId,
      signature,
      secret,
      liveSubscription: {
        id: subscriptionId,
        status: "active",
        plan_id: "plan_test_pro",
        customer_id: `cust_${suffix}`,
        notes: { organizationId: alpha.organization.id },
      },
    });
    expect(paid).toMatchObject({ ok: true, data: { confirmed: true, status: "ACTIVE" } });
    const row = await db.subscription.findUniqueOrThrow({ where: { organizationId: alpha.organization.id } });
    expect(row.plan).toBe("PRO");
    expect(row.leadLimit).toBe(2000);
  });

  it("maps cancellation to CANCELED and reduces limits without deleting data", async () => {
    await db.lead.create({
      data: { organizationId: alpha.organization.id, name: "Keep after cancel" },
    });
    await applyRazorpaySubscription({
      organizationId: alpha.organization.id,
      subscriptionId: `sub_cancel_${suffix}`,
      status: "cancelled",
      planId: "plan_test_pro",
    });
    const row = await db.subscription.findUniqueOrThrow({
      where: { organizationId: alpha.organization.id },
    });
    expect(row.status).toBe("CANCELED");
    expect(row.plan).toBe("PRO");
    expect(row.leadLimit).toBe(100);
    expect(row.seats).toBe(3);
    expect(isUnpaidSubscription(row.status)).toBe(true);
    expect(limitsForSubscriptionStatus("PRO", "CANCELED").leadLimit).toBe(100);
    expect(limitsForSubscriptionStatus("PRO", "PAST_DUE").leadLimit).toBe(2000);
    const leftover = await db.lead.count({
      where: { organizationId: alpha.organization.id, name: "Keep after cancel" },
    });
    expect(leftover).toBe(1);
    await expect(assertWithinLeadLimit(alpha.organization.id)).resolves.toBeUndefined();
  });

  it("rejects missing, malformed, unknown, and failed Razorpay webhook events", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
    const missing = await razorpayWebhook(
      new Request("http://localhost/api/webhooks/razorpay", { method: "POST", body: "{}" }),
    );
    expect(missing.status).toBe(400);

    const malformedBody = "not-json";
    const malformed = await razorpayWebhook(
      new Request("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        headers: { "x-razorpay-signature": signWebhook(malformedBody) },
        body: malformedBody,
      }),
    );
    expect(malformed.status).toBe(400);

    const unknownBody = JSON.stringify({
      event: "invoice.updated",
      created_at: Math.floor(Date.now() / 1000),
      payload: {},
    });
    const unknown = await razorpayWebhook(
      new Request("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        headers: { "x-razorpay-signature": signWebhook(unknownBody), "x-razorpay-event-id": `evt_unknown_${suffix}` },
        body: unknownBody,
      }),
    );
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toMatchObject({ ignored: true, reason: "unknown_event" });
    expect(isRecognizedRazorpayEvent("invoice.updated")).toBe(false);

    await db.subscription.update({
      where: { organizationId: alpha.organization.id },
      data: { provider: "razorpay", providerSubId: `sub_fail_${suffix}`, status: "ACTIVE", leadLimit: 2000 },
    });
    const failedBody = JSON.stringify({
      event: "payment.failed",
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        subscription: {
          entity: {
            id: `sub_fail_${suffix}`,
            status: "halted",
            plan_id: "plan_test_pro",
            notes: { organizationId: alpha.organization.id },
          },
        },
      },
    });
    const failed = await razorpayWebhook(
      new Request("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        headers: { "x-razorpay-signature": signWebhook(failedBody), "x-razorpay-event-id": `evt_fail_${suffix}` },
        body: failedBody,
      }),
    );
    expect(failed.status).toBe(200);
    const afterFail = await db.subscription.findUniqueOrThrow({
      where: { organizationId: alpha.organization.id },
    });
    expect(afterFail.status).toBe("PAST_DUE");
    expect(afterFail.leadLimit).toBe(2000);
  });

  it("lets platform admins view billing and denies agency users, without returning secrets", async () => {
    const env = adminEnv;
    await expect(loadAdminBilling(null, {}, env)).rejects.toBeInstanceOf(AuthError);
    await expect(loadAdminBilling(asUser(beta, "owner"), {}, env)).rejects.toMatchObject({ status: 403 });

    const page = await loadAdminBilling(asUser(alpha, "owner"), { page: 1, pageSize: 1 }, env);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(2);
    const next = await loadAdminBilling(asUser(alpha, "owner"), { page: 2, pageSize: 1 }, env);
    expect(next.items[0]?.organizationId).not.toBe(page.items[0]?.organizationId);

    const filtered = await loadAdminBilling(
      asUser(alpha, "owner"),
      { q: alpha.organization.id, pageSize: 20 },
      env,
    );
    expect(filtered.items.every((row) => row.organizationId === alpha.organization.id)).toBe(true);
    expect(JSON.stringify(filtered)).not.toMatch(/RAZORPAY_KEY_SECRET|WEBHOOK_SECRET|key_secret/);
  });
});
