import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { POST as chatPost } from "@/app/api/chat/route";
import { clerkAuthJsRedirect } from "@/lib/auth/paths";
import { db } from "@/lib/db";
import { canActOnFollowUp, completeFollowUpForUser } from "@/lib/follow-up/access";
import { emptyIntelligenceMetrics, getIntelligenceMetrics } from "@/lib/intelligence/metrics";
import { updateLeadFields } from "@/lib/leads/fields";
import { handleChatTurn } from "@/lib/chat/engine";
import { leadVisibilityWhere } from "@/lib/leads/service";
import { resolveAssigneeInOrganization } from "@/lib/org";
import { changeMembershipRole } from "@/lib/team/roles";
import { ownedId } from "@/lib/tenant";
import { createAgency } from "./helpers";

const suffix = `p1d${Date.now()}`;

describe("Phase 1D backend correctness", () => {
  let alpha: Awaited<ReturnType<typeof createAgency>>;
  let beta: Awaited<ReturnType<typeof createAgency>>;
  let alphaOwnerMembershipId: string;
  let alphaAgentMembershipId: string;
  let betaAgentMembershipId: string;

  beforeAll(async () => {
    alpha = await createAgency(`alpha-${suffix}`);
    beta = await createAgency(`beta-${suffix}`);
    const [alphaOwner, alphaAgent, betaAgent] = await Promise.all([
      db.membership.findFirstOrThrow({
        where: { organizationId: alpha.organization.id, userId: alpha.owner.id },
      }),
      db.membership.findFirstOrThrow({
        where: { organizationId: alpha.organization.id, userId: alpha.agent.id },
      }),
      db.membership.findFirstOrThrow({
        where: { organizationId: beta.organization.id, userId: beta.agent.id },
      }),
    ]);
    alphaOwnerMembershipId = alphaOwner.id;
    alphaAgentMembershipId = alphaAgent.id;
    betaAgentMembershipId = betaAgent.id;
  });

  afterAll(async () => {
    await alpha.cleanup();
    await beta.cleanup();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("assigns follow-ups only to current same-org members", async () => {
    await expect(resolveAssigneeInOrganization(alpha.organization.id, alpha.agent.id)).resolves.toBe(alpha.agent.id);
    await expect(resolveAssigneeInOrganization(alpha.organization.id, beta.agent.id)).resolves.toBeNull();
    await expect(resolveAssigneeInOrganization(alpha.organization.id, "missing-user")).resolves.toBeNull();
    await expect(resolveAssigneeInOrganization(alpha.organization.id, "")).resolves.toBeNull();
  });

  it("lets the assignee or a manager complete a follow-up and blocks everyone else", async () => {
    const lead = await db.lead.create({
      data: {
        organizationId: alpha.organization.id,
        name: "Follow-up Lead",
        assignedAgentId: alpha.agent.id,
      },
    });
    const followUp = await db.followUp.create({
      data: {
        organizationId: alpha.organization.id,
        leadId: lead.id,
        type: "DUE_REMINDER",
        assignedToId: alpha.agent.id,
        message: "Call back",
        dueAt: new Date(),
      },
    });

    expect(canActOnFollowUp({ id: alpha.agent.id, role: "SALES_AGENT" }, followUp)).toBe(true);
    expect(canActOnFollowUp({ id: alpha.owner.id, role: "OWNER" }, followUp)).toBe(true);
    expect(canActOnFollowUp({ id: beta.agent.id, role: "SALES_AGENT" }, followUp)).toBe(false);

    await expect(
      completeFollowUpForUser({
        organizationId: alpha.organization.id,
        user: { id: beta.agent.id, role: "SALES_AGENT" },
        followUpId: followUp.id,
      }),
    ).rejects.toThrow(/assigned to you/i);

    await expect(
      completeFollowUpForUser({
        organizationId: beta.organization.id,
        user: { id: beta.owner.id, role: "OWNER" },
        followUpId: followUp.id,
      }),
    ).rejects.toThrow(/not found/i);

    await completeFollowUpForUser({
      organizationId: alpha.organization.id,
      user: { id: alpha.agent.id, role: "SALES_AGENT" },
      followUpId: followUp.id,
    });
    const completed = await db.followUp.findFirstOrThrow({ where: { id: followUp.id } });
    expect(completed.status).toBe("COMPLETED");

    const crossDelete = await db.followUp.deleteMany({
      where: ownedId(beta.organization.id, followUp.id),
    });
    expect(crossDelete.count).toBe(0);
  });

  it("computes intelligence metrics in the database without loading every lead", async () => {
    await db.lead.createMany({
      data: [
        {
          organizationId: alpha.organization.id,
          name: "Hot active",
          status: "CONTACTED",
          temperature: "HOT",
          estimatedValue: 2_500_000,
          revenueAtRisk: 400_000,
        },
        {
          organizationId: alpha.organization.id,
          name: "Dormant candidate",
          status: "DORMANT",
          temperature: "WARM",
          leadScore: 80,
          estimatedValue: 1_200_000,
          revenueAtRisk: 200_000,
          isReactivated: false,
        },
        {
          organizationId: alpha.organization.id,
          name: "Reactivated",
          status: "QUALIFIED",
          temperature: "COLD",
          isReactivated: true,
          revenueAtRisk: 50_000,
        },
        {
          organizationId: beta.organization.id,
          name: "Other org",
          status: "DORMANT",
          temperature: "HOT",
          estimatedValue: 9_000_000,
          revenueAtRisk: 9_000_000,
        },
      ],
    });

    const spy = vi.spyOn(db.lead, "findMany");
    const empty = await getIntelligenceMetrics("");
    expect(empty).toEqual(emptyIntelligenceMetrics());

    const metrics = await getIntelligenceMetrics(alpha.organization.id);
    expect(spy).not.toHaveBeenCalled();
    expect(metrics.totalLeads).toBeGreaterThanOrEqual(3);
    expect(metrics.hotLeads).toBeGreaterThanOrEqual(1);
    expect(metrics.dormantLeads).toBeGreaterThanOrEqual(1);
    expect(metrics.reactivationCandidates).toBeGreaterThanOrEqual(1);
    expect(metrics.highValueLeads).toBeGreaterThanOrEqual(1);
    expect(metrics.revenueAtRisk).toBeGreaterThanOrEqual(650_000);

    const other = await getIntelligenceMetrics(beta.organization.id);
    expect(other.totalLeads).toBeGreaterThanOrEqual(1);
    expect(other.revenueAtRisk).toBeGreaterThanOrEqual(9_000_000);
    expect(other.totalLeads).not.toBe(metrics.totalLeads);
  });

  it("updates lead fields inside the organization and rejects invalid or cross-org edits", async () => {
    const lead = await db.lead.create({
      data: { organizationId: alpha.organization.id, name: "Editable Lead", location: "Marina" },
    });
    const updated = await updateLeadFields({
      organizationId: alpha.organization.id,
      leadId: lead.id,
      visibilityWhere: leadVisibilityWhere(alpha.organization.id, alpha.owner.id, true),
      fields: { name: "Updated Lead", location: "Downtown", notes: "Seen the unit" },
    });
    expect(updated?.name).toBe("Updated Lead");
    expect(updated?.location).toBe("Downtown");

    await expect(
      updateLeadFields({
        organizationId: alpha.organization.id,
        leadId: lead.id,
        visibilityWhere: leadVisibilityWhere(alpha.organization.id, alpha.owner.id, true),
        fields: { name: "A" },
      }),
    ).rejects.toThrow();

    await expect(
      updateLeadFields({
        organizationId: "",
        leadId: lead.id,
        visibilityWhere: {},
        fields: { name: "Nope" },
      }),
    ).rejects.toThrow(/not found/i);

    await expect(
      updateLeadFields({
        organizationId: beta.organization.id,
        leadId: lead.id,
        visibilityWhere: leadVisibilityWhere(beta.organization.id, beta.owner.id, true),
        fields: { name: "Hijacked" },
      }),
    ).rejects.toThrow(/not found/i);

    const intact = await db.lead.findFirstOrThrow({ where: { id: lead.id } });
    expect(intact.name).toBe("Updated Lead");
    expect(intact.organizationId).toBe(alpha.organization.id);
  });

  it("changes team roles with authorization and blocks escalation or cross-org writes", async () => {
    await changeMembershipRole({
      organizationId: alpha.organization.id,
      actorRole: "OWNER",
      membershipId: alphaAgentMembershipId,
      role: "SALES_MANAGER",
    });
    const promoted = await db.membership.findFirstOrThrow({ where: { id: alphaAgentMembershipId } });
    expect(promoted.role).toBe("SALES_MANAGER");

    await expect(
      changeMembershipRole({
        organizationId: alpha.organization.id,
        actorRole: "SALES_AGENT",
        membershipId: alphaAgentMembershipId,
        role: "ADMIN",
      }),
    ).rejects.toThrow(/owners and admins/i);

    await expect(
      changeMembershipRole({
        organizationId: alpha.organization.id,
        actorRole: "ADMIN",
        membershipId: alphaAgentMembershipId,
        role: "OWNER",
      }),
    ).rejects.toThrow(/only an owner/i);

    await expect(
      changeMembershipRole({
        organizationId: alpha.organization.id,
        actorRole: "OWNER",
        membershipId: alphaAgentMembershipId,
        role: "SUPERADMIN",
      }),
    ).rejects.toThrow(/invalid role/i);

    await expect(
      changeMembershipRole({
        organizationId: alpha.organization.id,
        actorRole: "OWNER",
        membershipId: betaAgentMembershipId,
        role: "ADMIN",
      }),
    ).rejects.toThrow(/not found/i);

    await expect(
      changeMembershipRole({
        organizationId: alpha.organization.id,
        actorRole: "OWNER",
        membershipId: alphaOwnerMembershipId,
        role: "SALES_AGENT",
      }),
    ).rejects.toThrow(/at least one owner/i);
  });

  it("redirects Auth.js pages to Clerk only when Clerk is enabled", () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(clerkAuthJsRedirect("/login")).toBeNull();

    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_clerk");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_clerk");
    expect(clerkAuthJsRedirect("/login")).toBe("/sign-in");
    expect(clerkAuthJsRedirect("/signup")).toBe("/sign-up");
    expect(clerkAuthJsRedirect("/forgot-password")).toBe("/sign-in?reset=1");
    expect(clerkAuthJsRedirect("/reset-password")).toBe("/sign-in?reset=1");
    expect(clerkAuthJsRedirect("/dashboard")).toBeNull();
  });

  it("does not invent a successful chat reply when the engine fails", async () => {
    await expect(
      handleChatTurn({ organizationId: alpha.organization.id, message: "   " }),
    ).rejects.toThrow(/cannot be empty/i);

    const widgetKey = `wl_${suffix}`;
    await db.organization.update({
      where: { id: alpha.organization.id },
      data: { widgetKey },
    });

    const invalid = await chatPost(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ widgetKey, message: "" }),
      }),
    );
    expect(invalid.status).toBe(400);

    const missing = await chatPost(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ widgetKey: "missing-widget-key", message: "Hello" }),
      }),
    );
    expect(missing.status).toBe(401);

    vi.spyOn(db.chatMessage, "create").mockRejectedValueOnce(new Error("provider down"));
    const failed = await chatPost(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10" },
        body: JSON.stringify({ widgetKey, message: "Looking for a villa" }),
      }),
    );
    const failedJson = await failed.json();
    expect(failed.status).toBe(500);
    expect(failedJson.error).toMatch(/unable to process/i);
    expect(failedJson.reply).toBeUndefined();
    expect(JSON.stringify(failedJson)).not.toContain("I can still help you look for homes");

    vi.spyOn(db.chatMessage, "create").mockRestore();
    const ok = await chatPost(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.11" },
        body: JSON.stringify({ widgetKey, message: "Marina 2 bed under 2M" }),
      }),
    );
    const okJson = await ok.json();
    expect(ok.status).toBe(200);
    expect(okJson.reply).toEqual(expect.any(String));
    expect(okJson.sessionId).toEqual(expect.any(String));
  });
});
