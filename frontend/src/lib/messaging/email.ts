import { db } from "@/lib/db";
import { parseJson } from "@/lib/format";
import type { MessagingProvider, OutboundMessage, SendResult } from "@/lib/messaging/types";

type EmailConfig = {
  smtpHost?: string;
  smtpUser?: string;
  smtpPass?: string;
  fromEmail?: string;
};

export type EmailTransport = (input: {
  to: string;
  from: string;
  subject: string;
  text: string;
}) => Promise<{ ok: boolean; id?: string; error?: string }>;

export type EmailConfigLoader = (organizationId: string) => Promise<(EmailConfig & { enabled: boolean }) | null>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMEOUT_MS = 12_000;

async function defaultLoadConfig(organizationId: string) {
  const integration = await db.integration.findFirst({
    where: { organizationId, type: "EMAIL" },
  });
  if (!integration) return null;
  return {
    enabled: integration.enabled,
    ...parseJson<EmailConfig>(integration.config, {}),
  };
}

async function defaultTransport(input: {
  to: string;
  from: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "Email delivery is not configured." };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  try {
    const result = await Promise.race([
      resend.emails.send({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: `<p>${input.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
      }),
    ]);
    if (result.error) {
      return { ok: false, error: result.error.message || "Email provider rejected the send." };
    }
    if (!result.data?.id) {
      return { ok: false, error: "Email provider did not confirm the send." };
    }
    return { ok: true, id: result.data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed.";
    if (/abort|timeout/i.test(message)) {
      return { ok: false, error: "Email provider timed out." };
    }
    return { ok: false, error: message };
  }
}

export class EmailProvider implements MessagingProvider {
  readonly channel = "EMAIL" as const;

  constructor(
    private readonly deps: {
      loadConfig?: EmailConfigLoader;
      transport?: EmailTransport;
    } = {},
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = message.to?.trim() ?? "";
    if (!to || !EMAIL_RE.test(to)) {
      return { ok: false, provider: "email", error: "A valid email address is required." };
    }
    if (!message.body?.trim()) {
      return { ok: false, provider: "email", error: "Message cannot be empty." };
    }
    if (!message.organizationId?.trim()) {
      return { ok: false, provider: "email", error: "Organization is required." };
    }

    const config = await (this.deps.loadConfig ?? defaultLoadConfig)(message.organizationId);
    const from = config?.fromEmail?.trim() || process.env.EMAIL_FROM?.trim() || "";
    const canDeliver = Boolean(config?.enabled && (config.smtpHost?.trim() || process.env.RESEND_API_KEY?.trim()));
    if (!canDeliver) {
      return { ok: false, provider: "email", error: "Email is not configured for this agency." };
    }
    if (!from || !EMAIL_RE.test(from)) {
      return { ok: false, provider: "email", error: "A valid from address is required." };
    }

    try {
      const result = await (this.deps.transport ?? defaultTransport)({
        to,
        from,
        subject: "Message from your advisor",
        text: message.body.trim(),
      });
      if (!result.ok) {
        return { ok: false, provider: "email", error: result.error ?? "Email provider rejected the send." };
      }
      if (!result.id) {
        return { ok: false, provider: "email", error: "Email provider did not confirm the send." };
      }
      return { ok: true, provider: "email", providerId: result.id };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Email send failed.";
      return {
        ok: false,
        provider: "email",
        error: /abort|timeout/i.test(messageText) ? "Email provider timed out." : messageText,
      };
    }
  }
}
