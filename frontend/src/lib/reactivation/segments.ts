import type { Prisma } from "@prisma/client";

export const REACTIVATION_SEGMENTS = [
  { id: "dormant_30", label: "Dormant 30+ days", days: 30, highValue: false, hot: false },
  { id: "dormant_60", label: "Dormant 60+ days", days: 60, highValue: false, hot: false },
  { id: "dormant_90", label: "Dormant 90+ days", days: 90, highValue: false, hot: false },
  { id: "high_value", label: "High-value dormant", days: 30, highValue: true, hot: false },
  { id: "hot_dormant", label: "Hot dormant", days: 14, highValue: false, hot: true },
  { id: "no_response", label: "No-response leads", days: 7, highValue: false, hot: false },
] as const;

export function segmentWhere(
  organizationId: string,
  segmentId: string,
  overrideDays?: number,
): Prisma.LeadWhereInput {
  const segment = REACTIVATION_SEGMENTS.find((item) => item.id === segmentId) ?? REACTIVATION_SEGMENTS[0];
  const days =
    typeof overrideDays === "number" && Number.isFinite(overrideDays) && overrideDays >= 1
      ? Math.min(overrideDays, 365)
      : segment.days;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return {
    organizationId,
    status: { in: segment.id === "no_response" ? ["NEW", "CONTACTED"] : ["DORMANT", "LOST"] },
    OR: [{ lastContactedAt: { lte: cutoff } }, { lastContactedAt: null, createdAt: { lte: cutoff } }],
    ...(segment.highValue ? { estimatedValue: { gte: 2_000_000 } } : {}),
    ...(segment.hot ? { temperature: "HOT" } : {}),
  };
}
