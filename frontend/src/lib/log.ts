type SecurityEvent =
  | "auth.failure"
  | "authz.denied"
  | "rate_limit"
  | "webhook.invalid_signature"
  | "webhook.missing_signature"
  | "webhook.unknown_integration"
  | "webhook.stale"
  | "billing.suspicious"
  | "server.error";

const SENSITIVE = /password|secret|token|authorization|api[_-]?key|cookie|credential|razorpay|paddle|postgres|database_url|bearer/i;

function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    if (SENSITIVE.test(value) || value.length > 240) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE.test(key) ? "[redacted]" : scrub(item);
    }
    return out;
  }
  return value;
}

export function logSecurity(event: SecurityEvent, details: Record<string, unknown> = {}) {
  console.warn(
    JSON.stringify({
      level: "warn",
      event,
      ts: new Date().toISOString(),
      ...((scrub(details) as Record<string, unknown>) ?? {}),
    }),
  );
}

export function logServerError(message: string, details: Record<string, unknown> = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      event: "server.error",
      ts: new Date().toISOString(),
      message,
      ...((scrub(details) as Record<string, unknown>) ?? {}),
    }),
  );
}
