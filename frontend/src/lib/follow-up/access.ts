import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { canViewAllLeads } from "@/lib/roles";
import { ownedId } from "@/lib/tenant";

export function canActOnFollowUp(
  user: { id: string; role: Role },
  followUp: { assignedToId?: string | null },
) {
  if (canViewAllLeads(user.role)) return true;
  if (!followUp.assignedToId) return false;
  return followUp.assignedToId === user.id;
}

export async function completeFollowUpForUser(input: {
  organizationId: string;
  user: { id: string; role: Role };
  followUpId: string;
}) {
  const followUp = await db.followUp.findFirst({
    where: { id: input.followUpId, organizationId: input.organizationId },
  });
  if (!followUp) throw new Error("Follow-up not found.");
  if (!canActOnFollowUp(input.user, followUp)) {
    throw new Error("You can only complete follow-ups assigned to you.");
  }
  const completed = await db.followUp.updateMany({
    where: ownedId(input.organizationId, input.followUpId),
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  if (completed.count === 0) throw new Error("Follow-up not found.");
  return followUp;
}
