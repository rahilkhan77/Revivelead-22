import type { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";

export const ADMIN_USER_PAGE_SIZE = 20;

const ROLES = new Set<Role>(["OWNER", "ADMIN", "SALES_MANAGER", "SALES_AGENT"]);

export type AdminUserRow = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string;
  organizationName: string;
  createdAt: Date;
  joinedAt: Date;
  lastActivityAt: Date;
};

function parseRole(value?: string) {
  if (!value) return undefined;
  return ROLES.has(value as Role) ? (value as Role) : undefined;
}

export async function listAdminUsers(
  input: {
    page?: number;
    pageSize?: number;
    q?: string;
    organizationId?: string;
    role?: string;
  } = {},
) {
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? ADMIN_USER_PAGE_SIZE));
  const page = Math.max(1, input.page ?? 1);
  const skip = (page - 1) * pageSize;
  const q = input.q?.trim().slice(0, 80);
  const role = parseRole(input.role);
  const organizationId = input.organizationId?.trim() || undefined;

  const where: Prisma.MembershipWhereInput = {
    ...(organizationId ? { organizationId } : {}),
    ...(role ? { role } : {}),
    ...(q
      ? {
          OR: [
            { user: { name: { contains: q } } },
            { user: { email: { contains: q } } },
            { organization: { name: { contains: q } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    db.membership.count({ where }),
    db.membership.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, createdAt: true, updatedAt: true } },
        organization: { select: { id: true, name: true } },
      },
    }),
  ]);

  const items: AdminUserRow[] = rows.map((row) => ({
    membershipId: row.id,
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: row.role,
    organizationId: row.organization.id,
    organizationName: row.organization.name,
    createdAt: row.user.createdAt,
    joinedAt: row.createdAt,
    lastActivityAt: row.user.updatedAt,
  }));

  return {
    items,
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    q: q ?? "",
    organizationId: organizationId ?? "",
    role: role ?? "",
  };
}
