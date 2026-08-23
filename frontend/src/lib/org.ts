import type { IntegrationType } from "@prisma/client";
import { safeEqual } from "@/lib/crypto/hash";
import { db } from "@/lib/db";
import { resolveIntegrationBySecret } from "@/lib/integrations/lookup";

export async function resolveOrgFromSecret(
  secret: string | null | undefined,
  types: IntegrationType[],
  organizationId?: string | null,
) {
  const integration = await resolveIntegrationBySecret(secret, types, organizationId);
  return integration?.organizationId ?? null;
}

export function cronAuthorized(
  expected: string | undefined,
  provided: string,
  nodeEnv = process.env.NODE_ENV,
) {
  if (!expected) {
    return nodeEnv !== "production";
  }
  return safeEqual(expected, provided);
}

export function requireCronSecret(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return cronAuthorized(expected, provided);
}

export async function findMembership(organizationId: string, userId: string) {
  if (!organizationId || !userId) return null;
  return db.membership.findFirst({
    where: { organizationId, userId },
  });
}

export async function resolveAssigneeInOrganization(organizationId: string, userId?: string | null) {
  if (!userId) return null;
  const membership = await findMembership(organizationId, userId);
  return membership ? userId : null;
}

export async function assertMemberInOrganization(organizationId: string, userId: string) {
  const membership = await findMembership(organizationId, userId);
  if (!membership) {
    throw new Error("That teammate does not belong to this organization.");
  }
  return membership;
}
