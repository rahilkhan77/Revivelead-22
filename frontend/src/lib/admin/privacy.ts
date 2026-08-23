const SENSITIVE_KEY =
  /password|secret|token|authorization|api[_-]?key|cookie|credential|razorpay|paddle|webhook|bearer|hash|access_token|refresh_token|keyhash|signature/i;

const MAX_VALUE_LENGTH = 160;

export function isSensitiveAdminKey(key: string) {
  return SENSITIVE_KEY.test(key);
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (SENSITIVE_KEY.test(value) || value.length > MAX_VALUE_LENGTH) return "[redacted]";
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 12).map(scrubValue);
  if (typeof value === "object") return sanitizeAdminMetadata(value as Record<string, unknown>);
  return "[redacted]";
}

export function sanitizeAdminMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = isSensitiveAdminKey(key) ? "[redacted]" : scrubValue(value);
  }
  return out;
}

export function parseSafeAuditMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return sanitizeAdminMetadata(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function summarizeSafeMetadata(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata).slice(0, 6);
  if (entries.length === 0) return "—";
  return entries
    .map(([key, value]) => {
      if (value == null) return `${key}=—`;
      if (typeof value === "object") return `${key}=[object]`;
      return `${key}=${String(value)}`;
    })
    .join(" · ");
}

export function integrationCredentialsConfigured(config: string | null | undefined) {
  if (!config) return false;
  try {
    const parsed = JSON.parse(config) as Record<string, unknown>;
    return ["secret", "accessToken", "webhookSecret", "password", "apiKey", "token"].some(
      (key) => typeof parsed[key] === "string" && String(parsed[key]).length > 0,
    );
  } catch {
    return false;
  }
}
