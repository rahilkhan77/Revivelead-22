import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/errors";
import {
  loadAdminActivity,
  loadAdminAgencyDetail,
  loadAdminAuditLogs,
  loadAdminSecurity,
  loadAdminUsers,
} from "@/lib/admin/access";
import { sanitizeAdminMetadata } from "@/lib/admin/privacy";
import { db } from "@/lib/db";
import { createAgency } from "./helpers";

const suffix = `p2b${Date.now()}`;

function asUser(
  agency: Awaited<ReturnType<typeof createAgency>>,
  who: "owner" | "agent",
): Parameters<typeof loadAdminUsers>[0] {
  const person = agency[who];
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    organizationId: agency.organization.id,
    organizationName: agency.organization.name,
    role: who === "owner" ? "OWNER" : "SALES_AGENT",
  };
}

describe("Phase 2B admin operations", () => {
  let alpha: Awaited<ReturnType<typeof createAgency>>;
  let beta: Awaited<ReturnType<typeof createAgency>>;
  let adminEnv: NodeJS.ProcessEnv;
  let operator: ReturnType<typeof asUser>;

  beforeAll(async () => {
    alpha = await createAgency(`alpha-${suffix}`);
    beta = await createAgency(`beta-${suffix}`);
    adminEnv = {
      ...process.env,
      REVIVELEAD_ADMIN_EMAILS: alpha.owner.email,
      REVIVELEAD_ADMIN_USER_IDS: "",
    };
    operator = asUser(alpha, "owner");

    const alphaLead = await db.lead.create({
      data: { organizationId: alpha.organization.id, name: "Alpha only lead" },
    });
    await db.lead.create({
      data: { organizationId: beta.organization.id, name: "Beta leak lead" },
    });
    await db.property.create({
      data: {
        organizationId: alpha.organization.id,
        title: "Alpha villa",
        type: "Villa",
        location: "Palm",
      },
    });
    await db.followUp.create({
      data: {
        organizationId: alpha.organization.id,
        leadId: alphaLead.id,
        type: "NEW_LEAD_RESPONSE",
        dueAt: new Date(),
      },
    });
    await db.integration.create({
      data: {
        organizationId: alpha.organization.id,
        type: "WEBHOOK",
        name: "Inbound",
        enabled: true,
        config: JSON.stringify({ secret: "whsec_should_never_appear", url: "https://example.com" }),
      },
    });
    await db.auditLog.create({
      data: {
        organizationId: alpha.organization.id,
        userId: alpha.owner.id,
        action: "lead.created",
        entity: "Lead",
        entityId: alphaLead.id,
        metadata: JSON.stringify({
          name: "Alpha only lead",
          secret: "sk_live_do_not_show",
          token: "tok_secret",
        }),
        createdAt: new Date("2026-01-01T10:00:00.000Z"),
      },
    });
    await db.auditLog.create({
      data: {
        organizationId: alpha.organization.id,
        userId: alpha.owner.id,
        action: "integration.updated",
        entity: "Integration",
        metadata: JSON.stringify({ password: "hunter2" }),
        createdAt: new Date("2026-08-01T10:00:00.000Z"),
      },
    });
    await db.auditLog.create({
      data: {
        organizationId: beta.organization.id,
        userId: beta.owner.id,
        action: "team.invited",
        entity: "Invitation",
        metadata: JSON.stringify({ email: "guest@example.com" }),
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await alpha.cleanup();
    await beta.cleanup();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies signed-out and customer callers on every Phase 2B loader", async () => {
    const customer = asUser(beta, "owner");
    const customerEnv = { ...process.env, REVIVELEAD_ADMIN_EMAILS: "", REVIVELEAD_ADMIN_USER_IDS: "" };

    await expect(loadAdminAgencyDetail(null, alpha.organization.id, adminEnv)).rejects.toBeInstanceOf(AuthError);
    await expect(loadAdminUsers(null, {}, adminEnv)).rejects.toMatchObject({
      message: "You must be signed in.",
      status: 401,
    });
    await expect(loadAdminAuditLogs(asUser(alpha, "agent"), {}, adminEnv)).rejects.toMatchObject({ status: 403 });
    await expect(loadAdminActivity(customer, {}, adminEnv)).rejects.toMatchObject({ status: 403 });
    await expect(loadAdminSecurity(customer, adminEnv)).rejects.toMatchObject({ status: 403 });
    await expect(loadAdminAgencyDetail(customer, alpha.organization.id, customerEnv)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("returns only the requested agency and handles unknown ids", async () => {
    const detail = await loadAdminAgencyDetail(operator, alpha.organization.id, adminEnv);
    expect(detail).not.toBeNull();
    expect(detail?.id).toBe(alpha.organization.id);
    expect(detail?.usage.leads).toBe(1);
    expect(detail?.usage.properties).toBe(1);
    expect(detail?.usage.followUps).toBe(1);
    expect(detail?.members.every((member) => member.email.includes(`alpha-${suffix}`))).toBe(true);
    expect(detail?.members.some((member) => member.email.includes(`beta-${suffix}`))).toBe(false);
    expect(JSON.stringify(detail)).not.toContain("whsec_should_never_appear");
    expect(JSON.stringify(detail)).not.toContain("sk_live_do_not_show");
    expect(detail?.integrations[0]?.credentialsConfigured).toBe(true);
    expect(detail?.billing.plan).toBe("PRO");

    const missing = await loadAdminAgencyDetail(operator, "org_does_not_exist", adminEnv);
    expect(missing).toBeNull();
  });

  it("pages users with agency association and never returns secrets", async () => {
    const first = await loadAdminUsers(operator, { page: 1, pageSize: 1 }, adminEnv);
    expect(first.items).toHaveLength(1);
    expect(first.total).toBeGreaterThanOrEqual(4);
    expect(first.pageCount).toBeGreaterThanOrEqual(4);

    const second = await loadAdminUsers(operator, { page: 2, pageSize: 1 }, adminEnv);
    expect(second.items[0]?.membershipId).not.toBe(first.items[0]?.membershipId);

    const filtered = await loadAdminUsers(
      operator,
      { organizationId: alpha.organization.id, pageSize: 20 },
      adminEnv,
    );
    expect(filtered.items.length).toBeGreaterThanOrEqual(2);
    expect(filtered.items.every((row) => row.organizationId === alpha.organization.id)).toBe(true);
    expect(filtered.items.some((row) => row.email === alpha.owner.email)).toBe(true);
    expect(JSON.stringify(filtered)).not.toContain("passwordHash");
    expect(JSON.stringify(filtered)).not.toMatch(/\$2[ab]\$/);
  });

  it("pages audit logs newest-first, filters in the database, and redacts secrets", async () => {
    const page = await loadAdminAuditLogs(
      operator,
      { organizationId: alpha.organization.id, pageSize: 10 },
      adminEnv,
    );
    expect(page.items.length).toBeGreaterThanOrEqual(2);
    expect(page.items.every((row) => row.organizationId === alpha.organization.id)).toBe(true);
    const times = page.items.map((row) => row.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(page.items[0]?.action).toBe("integration.updated");

    const paged = await loadAdminAuditLogs(operator, { page: 1, pageSize: 1 }, adminEnv);
    const next = await loadAdminAuditLogs(operator, { page: 2, pageSize: 1 }, adminEnv);
    expect(paged.items).toHaveLength(1);
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.id).not.toBe(paged.items[0]?.id);

    const leadsOnly = await loadAdminAuditLogs(operator, { action: "lead.created", pageSize: 20 }, adminEnv);
    expect(leadsOnly.items.length).toBeGreaterThanOrEqual(1);
    expect(leadsOnly.items.every((row) => row.action.includes("lead.created"))).toBe(true);

    const sensitive = page.items.find((row) => row.action === "lead.created");
    expect(sensitive?.metadata).toMatchObject({ name: "Alpha only lead", secret: "[redacted]", token: "[redacted]" });
    expect(JSON.stringify(page)).not.toContain("sk_live_do_not_show");
    expect(JSON.stringify(page)).not.toContain("hunter2");
  });

  it("uses AuditLog for activity and does not invent security events", async () => {
    const activity = await loadAdminActivity(operator, { category: "leads", pageSize: 20 }, adminEnv);
    expect(activity.items.length).toBeGreaterThanOrEqual(1);
    expect(activity.items.every((row) => row.action.startsWith("lead.") || row.action.startsWith("leads."))).toBe(true);

    const security = await loadAdminSecurity(operator, adminEnv);
    expect(security.notCaptured.length).toBeGreaterThan(0);
    expect(security.recent.every((row) => row.action.startsWith("integration."))).toBe(true);
    expect(JSON.stringify(security)).not.toContain("hunter2");
    expect(security.recordedActions.every((row) => typeof row.action === "string" && typeof row.count === "number")).toBe(true);
  });

  it("redacts sensitive metadata keys before they can reach the UI", () => {
    expect(
      sanitizeAdminMetadata({
        name: "ok",
        password: "secret",
        apiKey: "rk_live",
        nested: { authorization: "Bearer abc", count: 2 },
      }),
    ).toEqual({
      name: "ok",
      password: "[redacted]",
      apiKey: "[redacted]",
      nested: { authorization: "[redacted]", count: 2 },
    });
  });
});
