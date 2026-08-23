import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import type { Plan, SubscriptionStatus } from "@prisma/client";
import { getPlan } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import type { PaymentCheckoutInput, PaymentCheckoutResult, PaymentProvider } from "@/lib/providers/types";

export type RazorpayInvoiceItem = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  paidAt: Date | null;
  paymentId: string | null;
  invoiceUrl: string | null;
};

type RazorpayNotes = Record<string, string>;

export type RazorpaySubscriptionSnapshot = {
  id?: string | null;
  plan_id?: string | null;
  customer_id?: string | null;
  status?: string | null;
  current_end?: number | null;
  charge_at?: number | null;
  notes?: unknown;
};

export type RazorpayWebhookPayload = {
  event?: string;
  created_at?: number;
  payload?: {
    subscription?: { entity?: RazorpaySubscriptionSnapshot };
    payment?: {
      entity?: {
        id?: string;
        status?: string;
        notes?: unknown;
      };
    };
  };
};

const MONTHLY_CYCLES = 120;

export function isRazorpayEnabled() {
  return Boolean(process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim());
}

export function isRazorpayWebhookConfigured() {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET?.trim());
}

export function razorpayKeyId() {
  return process.env.RAZORPAY_KEY_ID?.trim() ?? "";
}

export function razorpayCheckoutEnvironment(): "sandbox" | "production" {
  return razorpayKeyId().startsWith("rzp_test_") ? "sandbox" : "production";
}

export function limitsForSubscriptionStatus(plan: Plan, status: SubscriptionStatus) {
  if (status === "ACTIVE" || status === "PAST_DUE") return getPlan(plan);
  return getPlan("STARTER");
}

export function razorpayPlanId(plan: Plan) {
  if (plan === "STARTER") return process.env.RAZORPAY_PLAN_STARTER?.trim() ?? "";
  if (plan === "PRO") return process.env.RAZORPAY_PLAN_PRO?.trim() ?? "";
  return "";
}

export function planFromRazorpayPlanId(planId?: string | null): Plan | null {
  if (!planId) return null;
  if (planId === process.env.RAZORPAY_PLAN_PRO?.trim()) return "PRO";
  if (planId === process.env.RAZORPAY_PLAN_STARTER?.trim()) return "STARTER";
  return null;
}

export function mapRazorpayStatus(status?: string | null): SubscriptionStatus {
  const value = (status ?? "").toLowerCase();
  if (value === "authenticated" || value === "active") return "ACTIVE";
  if (value === "pending" || value === "halted" || value === "paused") return "PAST_DUE";
  if (value === "cancelled" || value === "canceled" || value === "completed" || value === "expired") {
    return "CANCELED";
  }
  return "TRIALING";
}

export function notesRecord(notes: unknown): RazorpayNotes {
  if (!notes || Array.isArray(notes) || typeof notes !== "object") return {};
  const out: RazorpayNotes = {};
  for (const [key, value] of Object.entries(notes)) {
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
}

export function unixToDate(value?: number | null) {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

export function verifyRazorpayPaymentSignature(input: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
  secret: string;
}) {
  if (!input.paymentId || !input.subscriptionId || !input.signature || !input.secret) return false;
  const expected = createHmac("sha256", input.secret)
    .update(`${input.paymentId}|${input.subscriptionId}`)
    .digest("hex");
  return timingSafeEqualText(expected, input.signature);
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string, secret: string) {
  if (!rawBody || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqualText(expected, signature);
}

export function razorpayWebhookEventId(headerEventId: string | null | undefined, parsed: RazorpayWebhookPayload) {
  const header = headerEventId?.trim();
  if (header) return header;
  const subId = parsed.payload?.subscription?.entity?.id ?? "";
  const payId = parsed.payload?.payment?.entity?.id ?? "";
  return `${parsed.event ?? "unknown"}:${subId || payId || "unknown"}:${parsed.created_at ?? 0}`;
}

export function isStaleRazorpayEvent(createdAt: number | undefined, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!createdAt || !Number.isFinite(createdAt)) return true;
  return createdAt < nowSeconds - 48 * 60 * 60;
}

export function parseRazorpayWebhook(rawBody: string): RazorpayWebhookPayload | null {
  try {
    const parsed = JSON.parse(rawBody) as RazorpayWebhookPayload;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function applyRazorpaySubscription(input: {
  organizationId: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  status?: string | null;
  planId?: string | null;
  plan?: Plan | null;
  billingPeriod?: string | null;
  currentPeriodEnd?: Date | null;
}) {
  const org = await db.organization.findUnique({ where: { id: input.organizationId } });
  if (!org || org.isDemo) return;

  const plan = input.plan ?? planFromRazorpayPlanId(input.planId) ?? "STARTER";
  const status = mapRazorpayStatus(input.status);
  const definition = limitsForSubscriptionStatus(plan, status);

  await db.subscription.upsert({
    where: { organizationId: input.organizationId },
    update: {
      plan,
      status,
      seats: definition.seats,
      leadLimit: definition.leadLimit,
      automationLimit: definition.automationLimit,
      whatsappMonthlyLimit: definition.whatsappMonthlyLimit,
      billingPeriod: input.billingPeriod ?? undefined,
      provider: "razorpay",
      providerCustomerId: input.customerId ?? undefined,
      providerSubId: input.subscriptionId ?? undefined,
      currentPeriodEnd: input.currentPeriodEnd,
    },
    create: {
      organizationId: input.organizationId,
      plan,
      status,
      seats: definition.seats,
      leadLimit: definition.leadLimit,
      automationLimit: definition.automationLimit,
      whatsappMonthlyLimit: definition.whatsappMonthlyLimit,
      billingPeriod: input.billingPeriod ?? "month",
      provider: "razorpay",
      providerCustomerId: input.customerId ?? undefined,
      providerSubId: input.subscriptionId ?? undefined,
      currentPeriodEnd: input.currentPeriodEnd,
    },
  });
}

export async function markRazorpayPastDue(organizationId: string) {
  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org || org.isDemo) return;
  await db.subscription.updateMany({
    where: { organizationId },
    data: { status: "PAST_DUE" },
  });
}

export async function applyRazorpaySnapshot(organizationId: string, snapshot: RazorpaySubscriptionSnapshot) {
  const notes = notesRecord(snapshot.notes);
  const planFromNotes = notes.plan === "STARTER" || notes.plan === "PRO" || notes.plan === "ENTERPRISE" ? notes.plan : null;
  await applyRazorpaySubscription({
    organizationId,
    customerId: snapshot.customer_id,
    subscriptionId: snapshot.id,
    status: snapshot.status,
    planId: snapshot.plan_id,
    plan: planFromRazorpayPlanId(snapshot.plan_id) ?? planFromNotes,
    billingPeriod: "month",
    currentPeriodEnd: unixToDate(snapshot.current_end ?? snapshot.charge_at ?? null),
  });
}

export function getRazorpay() {
  if (process.env.VITEST) {
    throw new Error("Razorpay API is disabled in tests.");
  }
  const key_id = process.env.RAZORPAY_KEY_ID?.trim();
  const key_secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!key_id || !key_secret) throw new Error("Razorpay is not configured.");
  return new Razorpay({ key_id, key_secret });
}

export async function fetchRazorpaySubscription(subscriptionId: string) {
  const razorpay = getRazorpay();
  return razorpay.subscriptions.fetch(subscriptionId);
}

export async function listRazorpayInvoices(subscriptionId: string): Promise<RazorpayInvoiceItem[]> {
  if (!isRazorpayEnabled() || process.env.VITEST) return [];
  try {
    const razorpay = getRazorpay();
    const result = await razorpay.invoices.all({ subscription_id: subscriptionId, count: 20 } as never);
    const items = Array.isArray(result?.items) ? result.items : [];
    return items.map((item) => ({
      id: String(item.id ?? ""),
      status: String(item.status ?? "issued"),
      amount: Number(item.amount ?? 0),
      currency: String(item.currency ?? "USD"),
      paidAt: unixToDate(typeof item.paid_at === "number" ? item.paid_at : typeof item.date === "number" ? item.date : null),
      paymentId: typeof item.payment_id === "string" ? item.payment_id : null,
      invoiceUrl: typeof item.short_url === "string" ? item.short_url : null,
    }));
  } catch {
    return [];
  }
}

export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = "razorpay";

  enabled() {
    return isRazorpayEnabled();
  }

  async createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutResult> {
    const planId = razorpayPlanId(input.plan);
    if (!planId) {
      throw new Error(
        input.plan === "ENTERPRISE"
          ? "Enterprise billing is arranged with ReviveLead. There is no self-serve Razorpay plan."
          : "This plan does not have a Razorpay plan configured.",
      );
    }
    if (!input.email) throw new Error("An email is required to create a Razorpay customer.");

    const razorpay = getRazorpay();
    const existing = await db.subscription.findUnique({ where: { organizationId: input.organizationId } });
    const customerId = await ensureRazorpayCustomer({
      organizationId: input.organizationId,
      organizationName: input.organizationName,
      email: input.email,
      existingCustomerId: existing?.provider === "razorpay" ? existing.providerCustomerId : null,
    });

    const liveSubId = existing?.provider === "razorpay" ? existing.providerSubId : null;
    if (liveSubId) {
      try {
        const live = await razorpay.subscriptions.fetch(liveSubId);
        const liveStatus = String(live.status);
        const livePlanId = String(live.plan_id);
        if ((liveStatus === "active" || liveStatus === "authenticated") && livePlanId !== planId) {
          const currentPlan = planFromRazorpayPlanId(livePlanId);
          const currentPrice = currentPlan ? getPlan(currentPlan).priceMonthly : 0;
          const nextPrice = getPlan(input.plan).priceMonthly;
          const updated = await razorpay.subscriptions.update(liveSubId, {
            plan_id: planId,
            schedule_change_at: nextPrice > currentPrice ? "now" : "cycle_end",
            customer_notify: 1,
            notes: { organizationId: input.organizationId, plan: input.plan },
          });
          await applyRazorpaySnapshot(input.organizationId, updated);
          return {
            planUpdated: true,
            subscriptionId: liveSubId,
            environment: razorpayCheckoutEnvironment(),
          };
        }
        if (liveStatus === "created" && livePlanId !== planId) {
          await razorpay.subscriptions.update(liveSubId, {
            plan_id: planId,
            notes: { organizationId: input.organizationId, plan: input.plan },
          });
          return checkoutPayload(input, liveSubId);
        }
        if (liveStatus === "created" || (liveStatus === "authenticated" && livePlanId === planId)) {
          return checkoutPayload(input, liveSubId);
        }
      } catch (error) {
        if (!isMissingSubscription(error)) throw razorpayError(error);
      }
    }

    const created = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: MONTHLY_CYCLES,
      quantity: 1,
      customer_notify: 1,
      expire_by: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      notes: { organizationId: input.organizationId, plan: input.plan },
      customer_id: customerId,
    } as Parameters<typeof razorpay.subscriptions.create>[0] & { customer_id: string });

    await db.subscription.update({
      where: { organizationId: input.organizationId },
      data: {
        provider: "razorpay",
        providerCustomerId: customerId,
        providerSubId: created.id,
      },
    });

    return checkoutPayload(input, created.id);
  }

  async createPortalSession(input: { customerId: string; subscriptionId?: string | null }): Promise<{ url: string }> {
    void input;
    throw new Error("Razorpay billing is managed in ReviveLead. Use change plan, cancel, or resume on this page.");
  }

  async cancelSubscription(subscriptionId: string) {
    const razorpay = getRazorpay();
    await razorpay.subscriptions.cancel(subscriptionId, true);
  }

  async resumeSubscription(subscriptionId: string) {
    const razorpay = getRazorpay();
    return razorpay.subscriptions.resume(subscriptionId, { resume_at: "now" });
  }
}

function checkoutPayload(input: PaymentCheckoutInput, subscriptionId: string): PaymentCheckoutResult {
  const definition = getPlan(input.plan);
  return {
    subscriptionId,
    keyId: razorpayKeyId(),
    name: "ReviveLead",
    description: `${definition.name} · $${definition.priceMonthly}/month`,
    prefillName: input.organizationName,
    prefillEmail: input.email ?? undefined,
    environment: razorpayCheckoutEnvironment(),
  };
}

async function ensureRazorpayCustomer(input: {
  organizationId: string;
  organizationName: string;
  email: string;
  existingCustomerId?: string | null;
}) {
  if (input.existingCustomerId?.startsWith("cust_")) return input.existingCustomerId;
  const razorpay = getRazorpay();
  const trimmed = input.organizationName.trim().slice(0, 50);
  const name = trimmed.length >= 3 ? trimmed : `${trimmed || "Agency"} Co`.slice(0, 50);
  const customer = await razorpay.customers.create({
    name,
    email: input.email,
    fail_existing: 0,
    notes: { organizationId: input.organizationId },
  });
  await db.subscription.update({
    where: { organizationId: input.organizationId },
    data: { provider: "razorpay", providerCustomerId: customer.id },
  });
  return customer.id;
}

function timingSafeEqualText(expected: string, received: string) {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(received, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isMissingSubscription(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { statusCode?: number; error?: { code?: string } };
  return record.statusCode === 400 || record.error?.code === "BAD_REQUEST_ERROR";
}

function razorpayError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object") {
    const record = error as { error?: { description?: string }; description?: string; message?: string };
    const description = record.error?.description ?? record.description ?? record.message;
    if (description) return new Error(description);
  }
  return new Error("Razorpay request failed.");
}
