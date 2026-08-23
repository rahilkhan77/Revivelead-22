import { db } from "@/lib/db";

const CLOSED = ["WON", "LOST"] as const;
const INACTIVE = ["WON", "LOST", "DORMANT"] as const;

export async function getIntelligenceMetrics(organizationId: string) {
  if (!organizationId) {
    return emptyIntelligenceMetrics();
  }

  const scoped = { organizationId };
  const [
    totalLeads,
    activeLeads,
    dormantLeads,
    hotLeads,
    warmLeads,
    coldLeads,
    reactivationCandidates,
    highValueLeads,
    reactivatedLeads,
    atRisk,
    recovered,
    chat,
    chatLeads,
    handoffs,
  ] = await Promise.all([
    db.lead.count({ where: scoped }),
    db.lead.count({ where: { ...scoped, status: { notIn: [...INACTIVE] } } }),
    db.lead.count({ where: { ...scoped, status: "DORMANT" } }),
    db.lead.count({ where: { ...scoped, temperature: "HOT", status: { notIn: [...CLOSED] } } }),
    db.lead.count({ where: { ...scoped, temperature: "WARM", status: { notIn: [...CLOSED] } } }),
    db.lead.count({ where: { ...scoped, temperature: "COLD", status: { notIn: [...CLOSED] } } }),
    db.lead.count({
      where: {
        ...scoped,
        status: "DORMANT",
        OR: [{ estimatedValue: { gte: 1_000_000 } }, { leadScore: { gte: 70 } }, { temperature: "HOT" }],
      },
    }),
    db.lead.count({ where: { ...scoped, estimatedValue: { gte: 2_000_000 } } }),
    db.lead.count({ where: { ...scoped, isReactivated: true } }),
    db.lead.aggregate({
      where: scoped,
      _sum: { revenueAtRisk: true },
    }),
    db.revenueEvent.aggregate({
      where: { organizationId, type: "reactivated_won" },
      _sum: { amount: true },
    }),
    db.chatSession.aggregate({
      where: scoped,
      _count: true,
    }),
    db.chatSession.count({
      where: { organizationId, leadId: { not: null } },
    }),
    db.chatSession.count({
      where: { organizationId, status: "HANDOFF" },
    }),
  ]);

  const revenueAtRisk = atRisk._sum.revenueAtRisk ?? 0;
  const recoverablePool = dormantLeads + reactivatedLeads;

  return {
    totalLeads,
    activeLeads,
    dormantLeads,
    hotLeads,
    warmLeads,
    coldLeads,
    reactivationCandidates,
    highValueLeads,
    revenueAtRisk,
    estimatedRecoverable: Math.round(revenueAtRisk * 0.45),
    recoveredRevenue: recovered._sum.amount ?? 0,
    leadRecoveryRate: recoverablePool ? Math.round((reactivatedLeads / recoverablePool) * 100) : 0,
    chatSessions: chat._count,
    chatLeads,
    chatHandoffs: handoffs,
    chatConversion: chat._count ? Math.round((chatLeads / chat._count) * 100) : 0,
  };
}

export function emptyIntelligenceMetrics() {
  return {
    totalLeads: 0,
    activeLeads: 0,
    dormantLeads: 0,
    hotLeads: 0,
    warmLeads: 0,
    coldLeads: 0,
    reactivationCandidates: 0,
    highValueLeads: 0,
    revenueAtRisk: 0,
    estimatedRecoverable: 0,
    recoveredRevenue: 0,
    leadRecoveryRate: 0,
    chatSessions: 0,
    chatLeads: 0,
    chatHandoffs: 0,
    chatConversion: 0,
  };
}
