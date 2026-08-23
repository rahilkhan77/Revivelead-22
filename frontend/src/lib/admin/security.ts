import { parseSafeAuditMetadata, summarizeSafeMetadata } from "@/lib/admin/privacy";
import { db } from "@/lib/db";

const SECURITY_ACTION_PREFIXES = ["integration."];

export const SECURITY_NOT_CAPTURED = [
  "Failed sign-in attempts — written to server logs only, not stored in AuditLog.",
  "Webhook signature / unknown-integration failures — console security events, not persisted.",
  "Rate-limit events — console security events, not persisted.",
  "IP address and device metadata — not stored on AuditLog.",
  "Success/failure outcome flags — AuditLog has no success column.",
  "Platform-admin access denials — console security events, not persisted.",
] as const;

export async function getAdminSecurityOverview() {
  const where = {
    OR: SECURITY_ACTION_PREFIXES.map((prefix) => ({ action: { startsWith: prefix } })),
  };

  const [persistedCount, recent, actionCounts] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        action: true,
        entity: true,
        metadata: true,
        user: { select: { name: true, email: true } },
        organization: { select: { name: true } },
      },
    }),
    db.auditLog.groupBy({
      by: ["action"],
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } },
      take: 12,
    }),
  ]);

  return {
    persistedCount,
    notCaptured: [...SECURITY_NOT_CAPTURED],
    recent: recent.map((row) => {
      const metadata = parseSafeAuditMetadata(row.metadata);
      return {
        id: row.id,
        createdAt: row.createdAt,
        action: row.action,
        entity: row.entity,
        organizationName: row.organization.name,
        actorName: row.user?.name ?? null,
        actorEmail: row.user?.email ?? null,
        summary: summarizeSafeMetadata(metadata),
      };
    }),
    recordedActions: actionCounts.map((row) => ({
      action: row.action,
      count: row._count._all,
    })),
  };
}
