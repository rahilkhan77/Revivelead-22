import type { Integration, IntegrationType } from "@prisma/client";
import { safeEqual, sha256 } from "@/lib/crypto/hash";
import { db } from "@/lib/db";
import { parseJson } from "@/lib/format";

export type IntegrationSecretConfig = {
  secret?: string;
  webhookSecret?: string;
  phoneNumberId?: string;
  secretFingerprint?: string;
};

export function integrationSecretOf(config: IntegrationSecretConfig) {
  return (config.webhookSecret || config.secret || "").trim();
}

export function secretFingerprintOf(secret: string) {
  return sha256(secret.trim());
}

export function fingerprintContainsQuery(secret: string) {
  return `"secretFingerprint":"${secretFingerprintOf(secret)}"`;
}

export function phoneNumberIdContainsQuery(phoneNumberId: string) {
  return `"phoneNumberId":"${phoneNumberId}"`;
}

export function stampSecretFingerprint<T extends Record<string, unknown>>(config: T) {
  const secret = integrationSecretOf(config);
  const next = { ...config } as T & { secretFingerprint?: string };
  if (!secret) {
    delete next.secretFingerprint;
    return next;
  }
  next.secretFingerprint = secretFingerprintOf(secret);
  return next;
}

function parsedConfig(integration: Integration): IntegrationSecretConfig {
  return parseJson<IntegrationSecretConfig>(integration.config, {});
}

function secretMatches(integration: Integration, secret: string) {
  const stored = integrationSecretOf(parsedConfig(integration));
  return Boolean(stored) && safeEqual(stored, secret);
}

export async function resolveIntegrationById(
  id: string | null | undefined,
  types: IntegrationType[],
  organizationId?: string | null,
) {
  const integrationId = id?.trim() ?? "";
  if (!integrationId || types.length === 0) return null;
  return db.integration.findFirst({
    where: {
      id: integrationId,
      type: { in: types },
      enabled: true,
      ...(organizationId ? { organizationId } : {}),
    },
  });
}

export async function resolveIntegrationBySecret(
  secret: string | null | undefined,
  types: IntegrationType[],
  organizationId?: string | null,
) {
  const presented = secret?.trim() ?? "";
  if (!presented || types.length === 0) return null;

  const matches = await db.integration.findMany({
    where: {
      type: { in: types },
      enabled: true,
      config: { contains: fingerprintContainsQuery(presented) },
      ...(organizationId ? { organizationId } : {}),
    },
    take: 2,
  });

  const verified = matches.filter((item) => secretMatches(item, presented));
  if (verified.length !== 1) return null;
  return verified[0];
}

export async function resolveIntegrationByPhoneNumberId(
  phoneNumberId: string | null | undefined,
  organizationId?: string | null,
) {
  const id = phoneNumberId?.trim() ?? "";
  if (!id) return null;

  const matches = await db.integration.findMany({
    where: {
      type: "WHATSAPP",
      enabled: true,
      config: { contains: phoneNumberIdContainsQuery(id) },
      ...(organizationId ? { organizationId } : {}),
    },
    take: 5,
  });

  const exact = matches.filter((item) => parsedConfig(item).phoneNumberId === id);
  if (exact.length !== 1) return null;
  return exact[0];
}
