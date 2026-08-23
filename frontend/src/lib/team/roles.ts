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
