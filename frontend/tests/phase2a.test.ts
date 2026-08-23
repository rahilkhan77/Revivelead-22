import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/errors";
import { loadAdminAgencies, loadAdminOverview } from "@/lib/admin/access";
import { isPlatformAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import { createAgency } from "./helpers";

const suffix = `p2a${Date.now()}`;

function asUser(
  agency: Awaited<ReturnType<typeof createAgency>>,
  who: "owner" | "agent",
): Parameters<typeof loadAdminOverview>[0] {
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

describe("Phase 2A admin foundation", () => {
  let alpha: Awaited<ReturnType<typeof createAgency>>;
  let beta: Awaited<ReturnType<typeof createAgency>>;

  beforeAll(async () => {
    alpha = await createAgency(`alpha-${suffix}`);
    beta = await createAgency(`beta-${suffix}`);
    await db.lead.create({
      data: {
        organizationId: alpha.organization.id,
        name: "Admin metric lead",
        isReactivated: true,
        revenueAtRisk: 150000,
      },
    });
    await db.revenueEvent.create({
      data: {
        organizationId: alpha.organization.id,
        type: "reactivated_won",
        amount: 250000,
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

  it("does not treat agency roles as ReviveLead internal admins", () => {
    expect(isPlatformAdmin(asUser(alpha, "owner"), { ...process.env, REVIVELEAD_ADMIN_EMAILS: "", REVIVELEAD_ADMIN_USER_IDS: "" })).toBe(false);
    expect(isPlatformAdmin(asUser(alpha, "agent"), { ...process.env, REVIVELEAD_ADMIN_EMAILS: "", REVIVELEAD_ADMIN_USER_IDS: "" })).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });

  it("allows only allowlisted internal admins and denies everyone else", async () => {
    const env = {
      ...process.env,
      REVIVELEAD_ADMIN_EMAILS: alpha.owner.email,
      REVIVELEAD_ADMIN_USER_IDS: "",
    };
    const owner = asUser(alpha, "owner");
    const agent = asUser(alpha, "agent");
    const otherOwner = asUser(beta, "owner");

    expect(isPlatformAdmin(owner, env)).toBe(true);
    expect(isPlatformAdmin(agent, env)).toBe(false);
    expect(isPlatformAdmin(otherOwner, env)).toBe(false);

    await expect(loadAdminOverview(null, env)).rejects.toBeInstanceOf(AuthError);
    await expect(loadAdminOverview(agent, env)).rejects.toMatchObject({ message: "Admin access required.", status: 403 });
    await expect(loadAdminOverview(otherOwner, env)).rejects.toMatchObject({ status: 403 });
    await expect(loadAdminAgencies(agent, { page: 1 }, env)).rejects.toBeInstanceOf(AuthError);

    const overview = await loadAdminOverview(owner, env);
    expect(overview.totalAgencies).toBeGreaterThanOrEqual(2);
    expect(overview.totalLeads).toBeGreaterThanOrEqual(1);
    expect(overview.reactivatedLeads).toBeGreaterThanOrEqual(1);
    expect(overview.recoveredRevenue).toBeGreaterThanOrEqual(250000);
    expect(overview.revenueAtRisk).toBeGreaterThanOrEqual(150000);
  });

  it("lists agencies with pagination and does not leak rows to unauthorized users", async () => {
    const env = {
      ...process.env,
      REVIVELEAD_ADMIN_EMAILS: alpha.owner.email,
      REVIVELEAD_ADMIN_USER_IDS: "",
    };
    const owner = asUser(alpha, "owner");
    const first = await loadAdminAgencies(owner, { page: 1, pageSize: 1 }, env);
    expect(first.items).toHaveLength(1);
    expect(first.total).toBeGreaterThanOrEqual(2);
    expect(first.pageCount).toBeGreaterThanOrEqual(2);
    expect(first.items[0]?.name).toEqual(expect.any(String));
    expect(first.items[0]?.memberCount).toBeGreaterThanOrEqual(1);

    const second = await loadAdminAgencies(owner, { page: 2, pageSize: 1 }, env);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);

    const empty = await loadAdminAgencies(owner, { page: 99, pageSize: 1 }, env);
    expect(empty.items).toEqual([]);

    await expect(loadAdminAgencies(asUser(beta, "owner"), { page: 1 }, env)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("computes overview metrics from real database rows", async () => {
    const env = {
      ...process.env,
      REVIVELEAD_ADMIN_USER_IDS: alpha.owner.id,
      REVIVELEAD_ADMIN_EMAILS: "",
    };
    const metrics = await loadAdminOverview(asUser(alpha, "owner"), env);
    expect(metrics.totalUsers).toBeGreaterThanOrEqual(4);
    expect(metrics.totalMembers).toBeGreaterThanOrEqual(4);
    expect(metrics.activeAgencies + metrics.inactiveAgencies).toBeGreaterThanOrEqual(metrics.totalAgencies);
    expect(Object.values(metrics).every((value) => typeof value === "number")).toBe(true);
  });
});
