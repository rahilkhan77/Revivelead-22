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
  await recomputeLeadNextFollowUp(input.organizationId, followUp.leadId);
  return followUp;
}

/** Keep Lead.nextFollowUpAt in sync with the earliest still-pending follow-up (or null). */
export async function recomputeLeadNextFollowUp(organizationId: string, leadId: string) {
  const next = await db.followUp.findFirst({
    where: { organizationId, leadId, status: "PENDING" },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true },
  });
  await db.lead.updateMany({
    where: ownedId(organizationId, leadId),
    data: { nextFollowUpAt: next?.dueAt ?? null },
  });
}

export async function rescheduleFollowUpForUser(input: {
  organizationId: string;
  user: { id: string; role: Role };
  followUpId: string;
  dueAt: Date;
}) {
  if (Number.isNaN(input.dueAt.getTime())) throw new Error("Invalid due date.");
  const followUp = await db.followUp.findFirst({
    where: { id: input.followUpId, organizationId: input.organizationId },
  });
  if (!followUp) throw new Error("Follow-up not found.");
  if (!canActOnFollowUp(input.user, followUp)) {
    throw new Error("You can only reschedule follow-ups assigned to you.");
  }
  if (followUp.status !== "PENDING" && followUp.status !== "FAILED") {
    throw new Error("Only pending or failed follow-ups can be rescheduled.");
  }
  const updated = await db.followUp.updateMany({
    where: ownedId(input.organizationId, input.followUpId),
    data: { dueAt: input.dueAt, status: "PENDING" },
  });
  if (updated.count === 0) throw new Error("Follow-up not found.");
  await recomputeLeadNextFollowUp(input.organizationId, followUp.leadId);
  return followUp;
}

export async function cancelFollowUpForUser(input: {
  organizationId: string;
  user: { id: string; role: Role };
  followUpId: string;
}) {
  const followUp = await db.followUp.findFirst({
    where: { id: input.followUpId, organizationId: input.organizationId },
  });
  if (!followUp) throw new Error("Follow-up not found.");
  if (!canActOnFollowUp(input.user, followUp)) {
    throw new Error("You can only cancel follow-ups assigned to you.");
  }
  if (!["PENDING", "PROCESSING", "FAILED"].includes(followUp.status)) {
    throw new Error("Only open follow-ups can be cancelled.");
  }
  const cancelled = await db.followUp.updateMany({
    where: ownedId(input.organizationId, input.followUpId),
    data: { status: "CANCELLED" },
  });
  if (cancelled.count === 0) throw new Error("Follow-up not found.");
  await recomputeLeadNextFollowUp(input.organizationId, followUp.leadId);
  return followUp;
}
