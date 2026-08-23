import type { Prisma } from "@prisma/client";
import { parseSafeAuditMetadata, summarizeSafeMetadata } from "@/lib/admin/privacy";
import { db } from "@/lib/db";

export const ADMIN_AUDIT_PAGE_SIZE = 20;

export const ADMIN_ACTIVITY_CATEGORIES = [
  { id: "all", label: "All recorded", prefixes: [] as string[] },
  { id: "leads", label: "Leads", prefixes: ["lead.", "leads."] },
  { id: "properties", label: "Properties", prefixes: ["property."] },
  { id: "campaigns", label: "Campaigns", prefixes: ["campaign."] },
  { id: "team", label: "Team", prefixes: ["team."] },
  { id: "integrations", label: "Integrations", prefixes: ["integration."] },
  { id: "organizations", label: "Organizations", prefixes: ["organization."] },
  { id: "billing", label: "Billing", prefixes: ["billing."] },
] as const;

export type AdminActivityCategory = (typeof ADMIN_ACTIVITY_CATEGORIES)[number]["id"];

export type AdminAuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  entity: string;
  entityId: string | null;
  organizationId: string;
  organizationName: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  summary: string;
};

function parseDay(value?: string, endOfDay = false) {
  const raw = value?.trim();
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function actionWhere(input: { action?: string; category?: string }): Prisma.AuditLogWhereInput {
  const prefixes =
    ADMIN_ACTIVITY_CATEGORIES.find((item) => item.id === input.category)?.prefixes ?? [];
  if (prefixes.length > 0) {
    return { OR: prefixes.map((prefix) => ({ action: { startsWith: prefix } })) };
  }
  const action = input.action?.trim().slice(0, 80);
  if (action) return { action: { contains: action } };
  return {};
}

export async function listAdminAuditLogs(
  input: {
    page?: number;
    pageSize?: number;
    organizationId?: string;
    action?: string;
    actor?: string;
    entity?: string;
    from?: string;
    to?: string;
    category?: string;
  } = {},
) {
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? ADMIN_AUDIT_PAGE_SIZE));
  const page = Math.max(1, input.page ?? 1);
  const skip = (page - 1) * pageSize;
  const organizationId = input.organizationId?.trim() || undefined;
  const actor = input.actor?.trim().slice(0, 80);
  const entity = input.entity?.trim().slice(0, 80);
  const from = parseDay(input.from);
  const to = parseDay(input.to, true);

  const where: Prisma.AuditLogWhereInput = {
    ...actionWhere(input),
    ...(organizationId ? { organizationId } : {}),
    ...(entity ? { entity: { contains: entity } } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
    ...(actor
      ? {
          OR: [
            { userId: actor },
            { user: { email: { contains: actor } } },
            { user: { name: { contains: actor } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        action: true,
        entity: true,
        entityId: true,
        organizationId: true,
        userId: true,
        metadata: true,
        user: { select: { name: true, email: true } },
        organization: { select: { name: true } },
      },
    }),
  ]);

  const items: AdminAuditRow[] = rows.map((row) => {
    const metadata = parseSafeAuditMetadata(row.metadata);
    return {
      id: row.id,
      createdAt: row.createdAt,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      organizationId: row.organizationId,
      organizationName: row.organization.name,
      actorId: row.userId,
      actorName: row.user?.name ?? null,
      actorEmail: row.user?.email ?? null,
      metadata,
      summary: summarizeSafeMetadata(metadata),
    };
  });

  return {
    items,
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    organizationId: organizationId ?? "",
    action: input.action?.trim() ?? "",
    actor: actor ?? "",
    entity: entity ?? "",
    from: input.from?.trim() ?? "",
    to: input.to?.trim() ?? "",
    category: input.category ?? "all",
  };
}
