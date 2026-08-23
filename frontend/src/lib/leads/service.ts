import type { IntentType, LeadStatus, Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { runAutomations } from "@/lib/automations/engine";
import { qualifyLead } from "@/lib/ai/qualify";
import { assertMemberInOrganization } from "@/lib/org";
import { assertWithinLeadLimit } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { cancelOpenFollowUps, scheduleLeadSequence } from "@/lib/follow-up/engine";
import { LEAD_STATUSES } from "@/lib/constants";
import { normalizeEmail, normalizePhone } from "@/lib/leads/normalize";
import { calculateRevenueRisk } from "@/lib/revenue/risk";
import { dispatchWebhooks } from "@/lib/webhooks/dispatch";
import { logServerError } from "@/lib/log";

export type CreateLeadInput = {
  organizationId: string;
  actorId?: string;
  name: string;
  phone?: string;
  email?: string;
  source?: string;
  propertyType?: string;
  location?: string;
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  intent?: IntentType;
  timeline?: string;
  bedrooms?: number;
  notes?: string;
  assignedAgentId?: string;
  skipAi?: boolean;
};

export type IngestedLead = Awaited<ReturnType<typeof db.lead.create>> & {
  deduped?: boolean;
};

export async function assignNextAgent(organizationId: string) {
  const agents = await db.membership.findMany({
    where: {
      organizationId,
      role: { in: ["SALES_AGENT", "SALES_MANAGER"] },
    },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  if (agents.length === 0) return null;

  const counts = await db.lead.groupBy({
    by: ["assignedAgentId"],
    where: {
      organizationId,
      assignedAgentId: { in: agents.map((agent) => agent.userId) },
      status: { notIn: ["WON", "LOST"] },
    },
    _count: { _all: true },
  });
  const countByAgent = new Map(counts.map((row) => [row.assignedAgentId, row._count._all]));
  const next = [...agents].sort(
    (left, right) => (countByAgent.get(left.userId) ?? 0) - (countByAgent.get(right.userId) ?? 0),
  )[0];
  return next?.userId ?? null;
}

export async function findDuplicateLead(organizationId: string, phone?: string, email?: string) {
  const phoneNormalized = normalizePhone(phone);
  const emailNormalized = normalizeEmail(email);
  if (phoneNormalized) {
    const byPhone = await db.lead.findFirst({
      where: { organizationId, phoneNormalized },
    });
    if (byPhone) return byPhone;
  }
  if (emailNormalized) {
    return db.lead.findFirst({
      where: { organizationId, emailNormalized },
    });
  }
  return null;
}

export async function ingestLead(input: CreateLeadInput): Promise<IngestedLead> {
  const phoneNormalized = normalizePhone(input.phone);
  const emailNormalized = normalizeEmail(input.email);
  const duplicate = await findDuplicateLead(input.organizationId, input.phone, input.email);
  if (duplicate) {
    const notes = [duplicate.notes, input.notes].filter(Boolean).join("\n");
    const touched = await db.lead.updateMany({
      where: { id: duplicate.id, organizationId: input.organizationId },
      data: {
        notes: notes || duplicate.notes,
        phone: duplicate.phone ?? input.phone,
        email: duplicate.email ?? input.email,
        phoneNormalized: duplicate.phoneNormalized ?? phoneNormalized,
        emailNormalized: duplicate.emailNormalized ?? emailNormalized,
      },
    });
    if (touched.count === 0) return Object.assign(duplicate, { deduped: true });
    const updated = await db.lead.findFirstOrThrow({
      where: { id: duplicate.id, organizationId: input.organizationId },
    });
    return Object.assign(updated, { deduped: true });
  }

  await assertWithinLeadLimit(input.organizationId);
  if (input.assignedAgentId) {
    await assertMemberInOrganization(input.organizationId, input.assignedAgentId);
  }

  const assignedAgentId = input.assignedAgentId ?? (await assignNextAgent(input.organizationId));
  const organization = await db.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
  });

  const lead = await db.lead.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      phone: input.phone,
      email: input.email,
      phoneNormalized,
      emailNormalized,
      source: input.source,
      propertyType: input.propertyType,
      location: input.location,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      currency: input.currency ?? organization.currency,
      intent: input.intent ?? "UNKNOWN",
      timeline: input.timeline,
      bedrooms: input.bedrooms,
      notes: input.notes,
      assignedAgentId,
      estimatedValue: input.budgetMax ?? input.budgetMin,
    },
  });

  let qualified = lead;
  if (!input.skipAi) {
    try {
      const result = await qualifyLead({
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        source: lead.source,
        propertyType: lead.propertyType,
        location: lead.location,
        budgetMin: lead.budgetMin,
        budgetMax: lead.budgetMax,
        currency: lead.currency,
        intent: lead.intent,
        timeline: lead.timeline,
        bedrooms: lead.bedrooms,
        notes: lead.notes,
      });

      await db.lead.updateMany({
        where: { id: lead.id, organizationId: input.organizationId },
        data: {
          leadScore: result.leadScore,
          temperature: result.temperature,
          recommendedAction: result.recommendedAction,
          objections: result.objections,
          intent: result.intent,
          propertyType: result.propertyType ?? lead.propertyType,
          location: result.preferredLocation ?? lead.location,
          bedrooms: result.bedrooms ?? lead.bedrooms,
          budgetMin: result.budgetMin ?? lead.budgetMin,
          budgetMax: result.budgetMax ?? lead.budgetMax,
          currency: result.currency ?? lead.currency,
          timeline: result.timeline ?? lead.timeline,
          qualificationJson: JSON.stringify(result),
          estimatedValue: result.budgetMax ?? lead.estimatedValue,
          intentStrength: result.temperature === "HOT" ? "HIGH" : result.temperature === "WARM" ? "MEDIUM" : "LOW",
        },
      });
      qualified =
        (await db.lead.findFirst({
          where: { id: lead.id, organizationId: input.organizationId },
        })) ?? qualified;

      const risk = calculateRevenueRisk(qualified);
      await db.lead.updateMany({
        where: { id: lead.id, organizationId: input.organizationId },
        data: { riskScore: risk.riskScore, revenueAtRisk: risk.revenueAtRisk },
      });
      qualified =
        (await db.lead.findFirst({
          where: { id: lead.id, organizationId: input.organizationId },
        })) ?? qualified;

      if (result.temperature === "HOT") {
        await runAutomations(input.organizationId, "LEAD_BECOMES_HOT", lead.id);
        await dispatchWebhooks(input.organizationId, "lead.hot", { leadId: lead.id });
      }
      await dispatchWebhooks(input.organizationId, "lead.qualified", { leadId: lead.id, score: result.leadScore });
    } catch {
      logServerError("ai_qualification_failed");
    }
  }

  if (qualified.riskScore == null) {
    const risk = calculateRevenueRisk(qualified);
    await db.lead.updateMany({
      where: { id: lead.id, organizationId: input.organizationId },
      data: { riskScore: risk.riskScore, revenueAtRisk: risk.revenueAtRisk },
    });
    qualified =
      (await db.lead.findFirst({
        where: { id: lead.id, organizationId: input.organizationId },
      })) ?? qualified;
  }

  await scheduleLeadSequence(qualified, organization.settings, organization.timezone);
  await runAutomations(input.organizationId, "LEAD_CREATED", lead.id);
  await dispatchWebhooks(input.organizationId, "lead.created", { leadId: lead.id, name: lead.name });

  if (assignedAgentId) {
    await db.notification.create({
      data: {
        organizationId: input.organizationId,
        userId: assignedAgentId,
        type: "NEW_LEAD",
        title: `New lead: ${lead.name}`,
        body: qualified.recommendedAction ?? "A new lead is waiting for first contact.",
        link: `/leads/${lead.id}`,
      },
    });
  }

  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "lead.created",
    entity: "Lead",
    entityId: lead.id,
    metadata: { name: lead.name, score: qualified.leadScore },
  });

  return qualified;
}

export async function updateLeadStatus(input: {
  organizationId: string;
  leadId: string;
  status: LeadStatus;
  actorId?: string;
}) {
  const existing = await db.lead.findFirst({
    where: { id: input.leadId, organizationId: input.organizationId },
  });
  if (!existing) throw new Error("Lead not found.");
  if (!LEAD_STATUSES.includes(input.status)) {
    throw new Error("Invalid lead status.");
  }

  const data: Prisma.LeadUpdateInput = { status: input.status };
  if (input.status === "WON" && existing.status !== "WON" && existing.estimatedValue) {
    await db.revenueEvent.create({
      data: {
        organizationId: input.organizationId,
        leadId: existing.id,
        type: existing.isReactivated ? "reactivated_won" : "won",
        amount: existing.estimatedValue,
        note: existing.isReactivated
          ? "Deal won from a reactivated lead"
          : "Deal won",
      },
    });
    await dispatchWebhooks(input.organizationId, "deal.won", { leadId: existing.id });
    if (existing.isReactivated) {
      await dispatchWebhooks(input.organizationId, "revenue.recovered", {
        leadId: existing.id,
        amount: existing.estimatedValue,
      });
    }
  }

  if (input.status === "WON" || input.status === "LOST") {
    await db.followUp.updateMany({
      where: {
        leadId: existing.id,
        organizationId: input.organizationId,
        status: { in: ["PENDING", "PROCESSING"] },
      },
      data: { status: "CANCELLED" },
    });
  }

  const touched = await db.lead.updateMany({
    where: { id: existing.id, organizationId: input.organizationId },
    data,
  });
  if (touched.count === 0) throw new Error("Lead not found.");
  const updated = await db.lead.findFirstOrThrow({
    where: { id: existing.id, organizationId: input.organizationId },
  });

  await writeAudit({
    organizationId: input.organizationId,
    userId: input.actorId,
    action: "lead.status_changed",
    entity: "Lead",
    entityId: existing.id,
    metadata: { from: existing.status, to: input.status },
  });
  await dispatchWebhooks(input.organizationId, "lead.updated", {
    leadId: existing.id,
    from: existing.status,
    to: input.status,
  });

  return updated;
}

export function leadVisibilityWhere(organizationId: string, userId: string, canSeeAll: boolean) {
  return {
    organizationId,
    ...(canSeeAll ? {} : { assignedAgentId: userId }),
  };
}

export async function receiveLeadReply(input: {
  organizationId: string;
  leadId: string;
  body: string;
  channel?: "WHATSAPP" | "EMAIL";
  providerId?: string;
}) {
  const body = input.body.trim().slice(0, 4000);
  if (!body) throw new Error("Message cannot be empty.");

  const lead = await db.lead.findFirst({
    where: { id: input.leadId, organizationId: input.organizationId },
  });
  if (!lead) throw new Error("Lead not found.");

  if (input.providerId) {
    const existing = await db.leadMessage.findFirst({
      where: { organizationId: input.organizationId, providerId: input.providerId },
    });
    if (existing) return lead;
  }

  await db.leadMessage.create({
    data: {
      organizationId: input.organizationId,
      leadId: lead.id,
      direction: "INBOUND",
      channel: input.channel ?? "WHATSAPP",
      body,
      providerId: input.providerId,
    },
  });

  const { isOptOutMessage } = await import("@/lib/leads/opt-out");
  if (isOptOutMessage(body)) {
    await db.lead.updateMany({
      where: { id: lead.id, organizationId: input.organizationId },
      data: { optedOutAt: new Date(), lastContactedAt: new Date() },
    });
    await cancelOpenFollowUps(lead.id, input.organizationId);
    return lead;
  }

  await cancelOpenFollowUps(lead.id, input.organizationId);
  await db.lead.updateMany({
    where: { id: lead.id, organizationId: input.organizationId },
    data: { lastContactedAt: new Date() },
  });

  if (lead.assignedAgentId) {
    await db.notification.create({
      data: {
        organizationId: input.organizationId,
        userId: lead.assignedAgentId,
        type: "LEAD_REPLIED",
        title: `${lead.name} replied`,
        body,
        link: `/leads/${lead.id}`,
      },
    });
  }

  await dispatchWebhooks(input.organizationId, "lead.replied", { leadId: lead.id });
  return lead;
}
