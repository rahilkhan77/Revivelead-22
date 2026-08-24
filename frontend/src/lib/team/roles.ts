import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { ADMIN_ROLES } from "@/lib/constants";
import { memberRoleSchema } from "@/lib/roles";

export async function changeMembershipRole(input: {
  organizationId: string;
  actorRole: Role;
  membershipId: string;
  role: string;
}) {
  if (!ADMIN_ROLES.includes(input.actorRole)) {
    throw new Error("Only owners and admins can change roles.");
  }
  const parsedRole = memberRoleSchema.safeParse(input.role);
  if (!parsedRole.success) throw new Error("Invalid role.");
  const role = parsedRole.data;
  if (role === "OWNER" && input.actorRole !== "OWNER") {
    throw new Error("Only an owner can assign the owner role.");
  }

  const membership = await db.membership.findFirst({
    where: { id: input.membershipId, organizationId: input.organizationId },
  });
  if (!membership) throw new Error("Member not found.");
  if (membership.role === "OWNER" && role !== "OWNER") {
    const owners = await db.membership.count({
      where: { organizationId: input.organizationId, role: "OWNER" },
    });
    if (owners <= 1) throw new Error("An organization must keep at least one owner.");
  }

  const updated = await db.membership.updateMany({
    where: { id: input.membershipId, organizationId: input.organizationId },
    data: { role },
  });
  if (updated.count === 0) throw new Error("Member not found.");
  return { id: input.membershipId, role };
}

export async function removeMembership(input: {
  organizationId: string;
  actorRole: Role;
  actorUserId: string;
  membershipId: string;
}) {
  if (!ADMIN_ROLES.includes(input.actorRole)) {
    throw new Error("Only owners and admins can remove members.");
  }
  const membership = await db.membership.findFirst({
    where: { id: input.membershipId, organizationId: input.organizationId },
  });
  if (!membership) throw new Error("Member not found.");
  if (membership.userId === input.actorUserId) {
    throw new Error("You cannot remove yourself from the organization.");
  }
  if (membership.role === "OWNER") {
    if (input.actorRole !== "OWNER") {
      throw new Error("Only an owner can remove another owner.");
    }
    const owners = await db.membership.count({
      where: { organizationId: input.organizationId, role: "OWNER" },
    });
    if (owners <= 1) throw new Error("An organization must keep at least one owner.");
  }

  // Unassign the removed member's work so it stays visible to managers instead of pointing at a non-member.
  await db.$transaction([
    db.lead.updateMany({
      where: { organizationId: input.organizationId, assignedAgentId: membership.userId },
      data: { assignedAgentId: null },
    }),
    db.followUp.updateMany({
      where: {
        organizationId: input.organizationId,
        assignedToId: membership.userId,
        status: { in: ["PENDING", "PROCESSING", "FAILED"] },
      },
      data: { assignedToId: null },
    }),
    db.membership.deleteMany({
      where: { id: input.membershipId, organizationId: input.organizationId },
    }),
  ]);

  return { id: input.membershipId, userId: membership.userId };
}
