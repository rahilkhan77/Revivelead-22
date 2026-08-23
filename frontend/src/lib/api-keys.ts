import { db } from "@/lib/db";
import { apiKeyPair, sha256 } from "@/lib/crypto/hash";

export async function createApiKey(input: {
  organizationId: string;
  createdById: string;
  name: string;
}) {
  const pair = apiKeyPair();
  const record = await db.apiKey.create({
    data: {
      organizationId: input.organizationId,
      createdById: input.createdById,
      name: input.name || "n8n / API",
      prefix: pair.prefix,
      keyHash: pair.hash,
    },
  });
  return { id: record.id, prefix: record.prefix, secret: pair.secret };
}

export async function resolveOrgFromApiKey(raw?: string | null) {
  if (!raw) return null;
  const keyHash = sha256(raw.trim());
  const record = await db.apiKey.findFirst({
    where: { keyHash, revokedAt: null },
  });
  if (!record) return null;
  await db.apiKey.updateMany({
    where: { id: record.id, organizationId: record.organizationId },
    data: { lastUsedAt: new Date() },
  });
  return record.organizationId;
}

export async function revokeApiKey(organizationId: string, id: string) {
  await db.apiKey.updateMany({
    where: { id, organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
