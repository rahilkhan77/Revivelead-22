import type { Plan, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";

export const ADMIN_AGENCY_PAGE_SIZE = 20;

export type AdminAgencyRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  lastActivityAt: Date;
  status: string;
  plan: Plan | null;
  ownerName: string | null;
  ownerEmail: string | null;
  memberCount: number;
  leadCount: number;
};

export function agencyStatus(input: {
  isDemo: boolean;
  onboardingCompleted: boolean;
  subscriptionStatus: SubscriptionStatus | null;
}) {
  if (input.subscriptionStatus === "CANCELED") return "Canceled";
  if (input.subscriptionStatus === "PAST_DUE") return "Past due";
  if (input.isDemo) return "Demo";
  if (!input.onboardingCompleted) return "Onboarding";
  if (input.subscriptionStatus === "TRIALING") return "Trial";
  return "Active";
}

export async function listAdminAgencies(input: { page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? ADMIN_AGENCY_PAGE_SIZE));
  const page = Math.max(1, input.page ?? 1);
  const skip = (page - 1) * pageSize;

  const [total, organizations] = await Promise.all([
    db.organization.count(),
    db.organization.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
        isDemo: true,
        onboardingCompleted: true,
        subscription: { select: { plan: true, status: true } },
        memberships: {
          where: { role: "OWNER" },
          take: 1,
          select: { user: { select: { name: true, email: true } } },
        },
        _count: { select: { memberships: true, leads: true } },
      },
    }),
  ]);

  const ids = organizations.map((org) => org.id);
  const leadActivity =
    ids.length === 0
      ? []
      : await db.lead.groupBy({
          by: ["organizationId"],
          where: { organizationId: { in: ids } },
          _max: { updatedAt: true },
        });
  const lastLeadAt = new Map(leadActivity.map((row) => [row.organizationId, row._max.updatedAt]));

  const items: AdminAgencyRow[] = organizations.map((org) => {
    const leadUpdated = lastLeadAt.get(org.id);
    const lastActivityAt =
      leadUpdated && leadUpdated > org.updatedAt ? leadUpdated : org.updatedAt;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      createdAt: org.createdAt,
      lastActivityAt,
      status: agencyStatus({
        isDemo: org.isDemo,
        onboardingCompleted: org.onboardingCompleted,
        subscriptionStatus: org.subscription?.status ?? null,
      }),
      plan: org.subscription?.plan ?? null,
      ownerName: org.memberships[0]?.user.name ?? null,
      ownerEmail: org.memberships[0]?.user.email ?? null,
      memberCount: org._count.memberships,
      leadCount: org._count.leads,
    };
  });

  return {
    items,
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
