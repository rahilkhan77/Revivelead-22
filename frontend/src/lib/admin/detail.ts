import type { IntegrationType, Plan, Role, SubscriptionStatus } from "@prisma/client";
import { agencyStatus } from "@/lib/admin/agencies";
import { integrationCredentialsConfigured, parseSafeAuditMetadata, summarizeSafeMetadata } from "@/lib/admin/privacy";
import { db } from "@/lib/db";

export type AdminAgencyMember = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
  lastActivityAt: Date;
};

export type AdminAgencyIntegration = {
  id: string;
  type: IntegrationType;
  name: string;
  enabled: boolean;
  status: "CONNECTED" | "DISCONNECTED";
  createdAt: Date;
  lastActivityAt: Date;
  credentialsConfigured: boolean;
};

export type AdminAgencyActivity = {
  id: string;
  action: string;
  entity: string;
  actorName: string | null;
  createdAt: Date;
  summary: string;
};

export type AdminAgencyDetail = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  ownerName: string | null;
  ownerEmail: string | null;
  status: string;
  usage: {
    members: number;
    leads: number;
    properties: number;
    followUps: number;
    campaigns: number;
    messages: number;
    chatSessions: number;
    imports: number;
    reactivatedLeads: number;
  };
  billing: {
    plan: Plan | null;
    status: SubscriptionStatus | null;
    seats: number | null;
    leadLimit: number | null;
    currentPeriodEnd: Date | null;
    provider: string | null;
  };
  members: AdminAgencyMember[];
  integrations: AdminAgencyIntegration[];
  recentActivity: AdminAgencyActivity[];
};

export async function getAdminAgencyDetail(id: string): Promise<AdminAgencyDetail | null> {
  const organization = await db.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      isDemo: true,
      onboardingCompleted: true,
      subscription: {
        select: {
          plan: true,
          status: true,
          seats: true,
          leadLimit: true,
          currentPeriodEnd: true,
          provider: true,
        },
      },
      memberships: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, updatedAt: true } },
        },
      },
      integrations: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          type: true,
          name: true,
          enabled: true,
          config: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      _count: {
        select: {
          memberships: true,
          leads: true,
          properties: true,
          followUps: true,
          campaigns: true,
          chatSessions: true,
          imports: true,
        },
      },
    },
  });

  if (!organization) return null;

  const [messages, reactivatedLeads, recentLogs] = await Promise.all([
    db.leadMessage.count({ where: { organizationId: id } }),
    db.lead.count({ where: { organizationId: id, isReactivated: true } }),
    db.auditLog.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        action: true,
        entity: true,
        metadata: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  const owner = organization.memberships.find((row) => row.role === "OWNER");

  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt,
    ownerName: owner?.user.name ?? null,
    ownerEmail: owner?.user.email ?? null,
    status: agencyStatus({
      isDemo: organization.isDemo,
      onboardingCompleted: organization.onboardingCompleted,
      subscriptionStatus: organization.subscription?.status ?? null,
    }),
    usage: {
      members: organization._count.memberships,
      leads: organization._count.leads,
      properties: organization._count.properties,
      followUps: organization._count.followUps,
      campaigns: organization._count.campaigns,
      messages,
      chatSessions: organization._count.chatSessions,
      imports: organization._count.imports,
      reactivatedLeads,
    },
    billing: {
      plan: organization.subscription?.plan ?? null,
      status: organization.subscription?.status ?? null,
      seats: organization.subscription?.seats ?? null,
      leadLimit: organization.subscription?.leadLimit ?? null,
      currentPeriodEnd: organization.subscription?.currentPeriodEnd ?? null,
      provider: organization.subscription?.provider ?? null,
    },
    members: organization.memberships.map((row) => ({
      membershipId: row.id,
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: row.role,
      joinedAt: row.createdAt,
      lastActivityAt: row.user.updatedAt,
    })),
    integrations: organization.integrations.map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      enabled: row.enabled,
      status: row.enabled ? "CONNECTED" : "DISCONNECTED",
      createdAt: row.createdAt,
      lastActivityAt: row.updatedAt,
      credentialsConfigured: integrationCredentialsConfigured(row.config),
    })),
    recentActivity: recentLogs.map((row) => ({
      id: row.id,
      action: row.action,
      entity: row.entity,
      actorName: row.user?.name ?? null,
      createdAt: row.createdAt,
      summary: summarizeSafeMetadata(parseSafeAuditMetadata(row.metadata)),
    })),
  };
}
