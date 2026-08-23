import { db } from "@/lib/db";

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_SUBSCRIPTION = ["TRIALING", "ACTIVE"] as const;
const INACTIVE_SUBSCRIPTION = ["PAST_DUE", "CANCELED"] as const;

export async function getAdminOverviewMetrics() {
  const since = new Date(Date.now() - RECENT_MS);

  const [
    totalAgencies,
    activeAgencies,
    inactiveAgencies,
    totalUsers,
    totalMembers,
    recentUsers,
    totalLeads,
    recentLeads,
    reactivatedLeads,
    followUps,
    messages,
    chatSessions,
    recovered,
    atRisk,
  ] = await Promise.all([
    db.organization.count(),
    db.organization.count({
      where: {
        OR: [{ subscription: { status: { in: [...ACTIVE_SUBSCRIPTION] } } }, { subscription: null }],
      },
    }),
    db.organization.count({
      where: { subscription: { status: { in: [...INACTIVE_SUBSCRIPTION] } } },
    }),
    db.user.count(),
    db.membership.count(),
    db.user.count({ where: { createdAt: { gte: since } } }),
    db.lead.count(),
    db.lead.count({ where: { createdAt: { gte: since } } }),
    db.lead.count({ where: { isReactivated: true } }),
    db.followUp.count(),
    db.leadMessage.count(),
    db.chatSession.count(),
    db.revenueEvent.aggregate({
      where: { type: "reactivated_won" },
      _sum: { amount: true },
    }),
    db.lead.aggregate({
      _sum: { revenueAtRisk: true },
    }),
  ]);

  return {
    totalAgencies,
    activeAgencies,
    inactiveAgencies,
    totalUsers,
    totalMembers,
    recentUsers,
    totalLeads,
    recentLeads,
    reactivatedLeads,
    followUps,
    messages,
    chatSessions,
    recoveredRevenue: recovered._sum.amount ?? 0,
    revenueAtRisk: atRisk._sum.revenueAtRisk ?? 0,
  };
}
