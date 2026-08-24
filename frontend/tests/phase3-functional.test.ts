import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  cancelFollowUpForUser,
  recomputeLeadNextFollowUp,
  rescheduleFollowUpForUser,
} from "@/lib/follow-up/access";
import { removeMembership } from "@/lib/team/roles";
import { segmentWhere } from "@/lib/reactivation/segments";
import { createAgency } from "./helpers";

const suffix = `fx${Date.now()}`;
const DAY = 86_400_000;

describe("Phase 3 — follow-up reschedule / cancel", () => {
  let agency: Awaited<ReturnType<typeof createAgency>>;

  beforeAll(async () => {
    agency = await createAgency(`fu-${suffix}`);
  });
  afterAll(async () => {
    await agency.cleanup();
  });

  const owner = () => ({ id: agency.owner.id, role: "OWNER" as const });

  async function makeLeadWithFollowUps(phone: string) {
    const lead = await db.lead.create({
      data: {
        organizationId: agency.organization.id,
        name: "Follow-up Target",
        phone,
        status: "NEW",
        assignedAgentId: agency.agent.id,
      },
    });
    const f1 = await db.followUp.create({
      data: {
        organizationId: agency.organization.id,
        leadId: lead.id,
        type: "DUE_REMINDER",
        status: "PENDING",
        dueAt: new Date(Date.now() + DAY),
        assignedToId: agency.agent.id,
      },
    });
    const f2 = await db.followUp.create({
      data: {
        organizationId: agency.organization.id,
        leadId: lead.id,
        type: "DUE_REMINDER",
        status: "PENDING",
        dueAt: new Date(Date.now() + 3 * DAY),
        assignedToId: agency.agent.id,
      },
    });
    return { lead, f1, f2 };
  }

  it("cancels a follow-up and recomputes the lead's next follow-up", async () => {
    const { lead, f1, f2 } = await makeLeadWithFollowUps("+9715010000001");
    await recomputeLeadNextFollowUp(agency.organization.id, lead.id);
    const before = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(before.nextFollowUpAt?.getTime()).toBe(f1.dueAt.getTime());

    await cancelFollowUpForUser({
      organizationId: agency.organization.id,
      user: owner(),
      followUpId: f1.id,
    });

    const cancelled = await db.followUp.findUniqueOrThrow({ where: { id: f1.id } });
    expect(cancelled.status).toBe("CANCELLED");
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.nextFollowUpAt?.getTime()).toBe(f2.dueAt.getTime());
  });

  it("reschedules a pending follow-up and syncs the lead", async () => {
    const { lead, f1 } = await makeLeadWithFollowUps("+9715010000002");
    const newDue = new Date(Date.now() + 2 * 3600_000);
    await rescheduleFollowUpForUser({
      organizationId: agency.organization.id,
      user: owner(),
      followUpId: f1.id,
      dueAt: newDue,
    });
    const updated = await db.followUp.findUniqueOrThrow({ where: { id: f1.id } });
    expect(updated.status).toBe("PENDING");
    expect(updated.dueAt.getTime()).toBe(newDue.getTime());
    const lead2 = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(lead2.nextFollowUpAt?.getTime()).toBe(newDue.getTime());
  });

  it("refuses to reschedule a completed follow-up", async () => {
    const { f2 } = await makeLeadWithFollowUps("+9715010000003");
    await db.followUp.update({
      where: { id: f2.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await expect(
      rescheduleFollowUpForUser({
        organizationId: agency.organization.id,
        user: owner(),
        followUpId: f2.id,
        dueAt: new Date(Date.now() + DAY),
      }),
    ).rejects.toThrow(/pending or failed/i);
  });

  it("cannot act on another organization's follow-up", async () => {
    const other = await createAgency(`fu2-${suffix}`);
    try {
      const lead = await db.lead.create({
        data: {
          organizationId: other.organization.id,
          name: "Other Org",
          phone: "+9715010000004",
          status: "NEW",
        },
      });
      const foreign = await db.followUp.create({
        data: {
          organizationId: other.organization.id,
          leadId: lead.id,
          type: "DUE_REMINDER",
          status: "PENDING",
          dueAt: new Date(Date.now() + DAY),
        },
      });
      await expect(
        cancelFollowUpForUser({
          organizationId: agency.organization.id,
          user: owner(),
          followUpId: foreign.id,
        }),
      ).rejects.toThrow(/not found/i);
    } finally {
      await other.cleanup();
    }
  });
});

describe("Phase 3 — team member removal", () => {
  let agency: Awaited<ReturnType<typeof createAgency>>;
  let adminId: string;

  beforeAll(async () => {
    agency = await createAgency(`team-${suffix}`);
    const admin = await db.user.create({
      data: { name: "Admin User", email: `admin-${suffix}@example.com`, passwordHash: "x" },
    });
    await db.membership.create({
      data: { userId: admin.id, organizationId: agency.organization.id, role: "ADMIN" },
    });
    adminId = admin.id;
  });
  afterAll(async () => {
    await db.user.delete({ where: { id: adminId } }).catch(() => {});
    await agency.cleanup();
  });

  async function membershipId(userId: string) {
    const membership = await db.membership.findFirstOrThrow({
      where: { userId, organizationId: agency.organization.id },
    });
    return membership.id;
  }

  it("enforces removal guards", async () => {
    const ownerMembership = await membershipId(agency.owner.id);
    const agentMembership = await membershipId(agency.agent.id);

    await expect(
      removeMembership({
        organizationId: agency.organization.id,
        actorRole: "SALES_AGENT",
        actorUserId: agency.agent.id,
        membershipId: agentMembership,
      }),
    ).rejects.toThrow(/owners and admins/i);

    await expect(
      removeMembership({
        organizationId: agency.organization.id,
        actorRole: "OWNER",
        actorUserId: agency.owner.id,
        membershipId: ownerMembership,
      }),
    ).rejects.toThrow(/yourself/i);

    await expect(
      removeMembership({
        organizationId: agency.organization.id,
        actorRole: "ADMIN",
        actorUserId: adminId,
        membershipId: ownerMembership,
      }),
    ).rejects.toThrow(/owner/i);
  });

  it("removes a member and unassigns their leads and open follow-ups", async () => {
    const lead = await db.lead.create({
      data: {
        organizationId: agency.organization.id,
        name: "Assigned Lead",
        phone: "+9715010000021",
        status: "NEW",
        assignedAgentId: agency.agent.id,
      },
    });
    const followUp = await db.followUp.create({
      data: {
        organizationId: agency.organization.id,
        leadId: lead.id,
        type: "DUE_REMINDER",
        status: "PENDING",
        dueAt: new Date(Date.now() + DAY),
        assignedToId: agency.agent.id,
      },
    });
    const agentMembership = await membershipId(agency.agent.id);

    await removeMembership({
      organizationId: agency.organization.id,
      actorRole: "OWNER",
      actorUserId: agency.owner.id,
      membershipId: agentMembership,
    });

    expect(await db.membership.findFirst({ where: { id: agentMembership } })).toBeNull();
    const leadAfter = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(leadAfter.assignedAgentId).toBeNull();
    const followUpAfter = await db.followUp.findUniqueOrThrow({ where: { id: followUp.id } });
    expect(followUpAfter.assignedToId).toBeNull();
  });
});

describe("Phase 3 — reactivation day filter", () => {
  let agency: Awaited<ReturnType<typeof createAgency>>;

  beforeAll(async () => {
    agency = await createAgency(`seg-${suffix}`);
  });
  afterAll(async () => {
    await agency.cleanup();
  });

  it("honours the override days to widen the dormant window", async () => {
    const lead = await db.lead.create({
      data: {
        organizationId: agency.organization.id,
        name: "Dormant 20d",
        phone: "+9715010000031",
        status: "DORMANT",
        lastContactedAt: new Date(Date.now() - 20 * DAY),
      },
    });

    const defaultWindow = await db.lead.findMany({
      where: segmentWhere(agency.organization.id, "dormant_30"),
    });
    expect(defaultWindow.some((item) => item.id === lead.id)).toBe(false);

    const widened = await db.lead.findMany({
      where: segmentWhere(agency.organization.id, "dormant_30", 15),
    });
    expect(widened.some((item) => item.id === lead.id)).toBe(true);
  });
});
