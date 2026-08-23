import { parseJson } from "@/lib/format";

export type WhatsAppConfig = {
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  fromNumber?: string;
  secret?: string;
  webhookSecret?: string;
  secretFingerprint?: string;
};

export function parseWhatsAppConfig(raw: string | null | undefined): WhatsAppConfig {
  return parseJson<WhatsAppConfig>(raw, {});
}

export function webhookSecretOf(config: WhatsAppConfig) {
  return config.webhookSecret || config.secret || "";
}

export function maskSecret(value?: string | null) {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export function looksMasked(value?: string | null) {
  return !value || value.startsWith("••••") || value.trim() === "";
}

export function whatsappStatus(enabled: boolean, config: WhatsAppConfig) {
  if (!enabled) return "DISCONNECTED" as const;
  if (!config.accessToken || !config.phoneNumberId) return "ERROR" as const;
  return "CONNECTED" as const;
}

export function sanitizeProviderError(text: string) {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .slice(0, 400);
}
