import type { Plan, Prisma, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";

export const ADMIN_BILLING_PAGE_SIZE = 20;

const PLANS = new Set<Plan>(["STARTER", "PRO", "ENTERPRISE"]);
const STATUSES = new Set<SubscriptionStatus>(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]);

export type AdminBillingRow = {
  organizationId: string;
  organizationName: string;
  plan: Plan;
  status: SubscriptionStatus;
  billingPeriod: string | null;
  currentPeriodEnd: Date | null;
  provider: string | null;
  providerCustomerId: string | null;
  providerSubId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastBillingEventAt: Date | null;
  lastBillingAction: string | null;
};

function parsePlan(value?: string) {
  return value && PLANS.has(value as Plan) ? (value as Plan) : undefined;
}

function parseStatus(value?: string) {
  return value && STATUSES.has(value as SubscriptionStatus) ? (value as SubscriptionStatus) : undefined;
}

export async function listAdminBilling(
  input: {
    page?: number;
    pageSize?: number;
    q?: string;
    plan?: string;
    status?: string;
  } = {},
) {
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? ADMIN_BILLING_PAGE_SIZE));
  const page = Math.max(1, input.page ?? 1);
  const skip = (page - 1) * pageSize;
  const q = input.q?.trim().slice(0, 80);
  const plan = parsePlan(input.plan);
  const status = parseStatus(input.status);

  const where: Prisma.SubscriptionWhereInput = {
    ...(plan ? { plan } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          organization: {
            OR: [{ name: { contains: q } }, { id: q }],
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.subscription.count({ where }),
    db.subscription.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
      select: {
        organizationId: true,
        plan: true,
        status: true,
        billingPeriod: true,
        currentPeriodEnd: true,
        provider: true,
        providerCustomerId: true,
        providerSubId: true,
        createdAt: true,
        updatedAt: true,
        organization: { select: { name: true } },
      },
    }),
  ]);

  const ids = rows.map((row) => row.organizationId);
  const events =
    ids.length === 0
      ? []
      : await db.auditLog.findMany({
          where: { organizationId: { in: ids }, action: { startsWith: "billing." } },
          orderBy: { createdAt: "desc" },
          select: { organizationId: true, action: true, createdAt: true },
          take: ids.length * 4,
        });

  const latest = new Map<string, { action: string; createdAt: Date }>();
  for (const event of events) {
    if (!latest.has(event.organizationId)) {
      latest.set(event.organizationId, { action: event.action, createdAt: event.createdAt });
    }
  }

  const items: AdminBillingRow[] = rows.map((row) => {
    const event = latest.get(row.organizationId);
    return {
      organizationId: row.organizationId,
      organizationName: row.organization.name,
      plan: row.plan,
      status: row.status,
      billingPeriod: row.billingPeriod,
      currentPeriodEnd: row.currentPeriodEnd,
      provider: row.provider,
      providerCustomerId: row.providerCustomerId,
      providerSubId: row.providerSubId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastBillingEventAt: event?.createdAt ?? row.updatedAt,
      lastBillingAction: event?.action ?? null,
    };
  });

  return {
    items,
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    q: q ?? "",
    plan: plan ?? "",
    status: status ?? "",
  };
}
