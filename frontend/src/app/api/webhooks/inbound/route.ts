import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveOrgFromSecret } from "@/lib/org";
import { payloadTooLarge, tooManyRequests } from "@/lib/http";
import {
  resolveIntegrationById,
  resolveIntegrationByPhoneNumberId,
} from "@/lib/integrations/lookup";
import { logSecurity } from "@/lib/log";
import { clientKey, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import {
  customInboundEventId,
  inboundIntegrationId,
  inboundSignatureHeader,
  verifyInboundSignature,
} from "@/lib/webhooks/inbound-auth";
import { claimWebhookEvent } from "@/lib/webhooks/idempotency";
import {
  handleInboundWhatsApp,
  isMetaWhatsAppPayload,
  metaPhoneNumberId,
  parseMetaWhatsAppPayload,
} from "@/lib/whatsapp/inbound";
import { parseWhatsAppConfig, webhookSecretOf } from "@/lib/whatsapp/config";

const customSchema = z.object({
  phone: z.string().min(4).max(40).optional(),
  from: z.string().min(4).max(40).optional(),
  body: z.string().min(1).max(4000).optional(),
  text: z.string().min(1).max(4000).optional(),
  eventId: z.string().trim().max(160).optional(),
  id: z.string().trim().max(160).optional(),
  providerId: z.string().trim().max(160).optional(),
  organizationId: z.string().trim().max(80).optional(),
});

function unauthorized(error: string, status = 401) {
  return NextResponse.json({ error }, { status });
}

function integrationSecret(config: string | null | undefined) {
  return webhookSecretOf(parseWhatsAppConfig(config));
}

export async function GET(request: Request) {
  const limited = await rateLimit(clientKey(request, "inbound-verify"), "auth");
  if (!limited.ok) return tooManyRequests(retryAfterSeconds(limited));
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && challenge) {
    const organizationId = await resolveOrgFromSecret(token, ["WHATSAPP"]);
    if (!organizationId) {
      logSecurity("webhook.unknown_integration", { provider: "whatsapp", path: "verify" });
      return new NextResponse("Forbidden", { status: 403 });
    }
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const limited = await rateLimit(clientKey(request, "inbound"), "webhook");
  if (!limited.ok) {
    return tooManyRequests(retryAfterSeconds(limited));
  }
  if (payloadTooLarge(request)) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const raw = await request.text();
  const signature = inboundSignatureHeader(request);
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (isMetaWhatsAppPayload(payload) || parseMetaWhatsAppPayload(payload).length > 0) {
    const phoneNumberId = metaPhoneNumberId(payload);
    const integration = await resolveIntegrationByPhoneNumberId(phoneNumberId);
    if (!integration) {
      logSecurity("webhook.unknown_integration", { provider: "whatsapp" });
      return unauthorized("Unknown integration");
    }
    if (!signature) {
      logSecurity("webhook.missing_signature", { provider: "whatsapp", integrationId: integration.id });
      return unauthorized("Missing signature");
    }
    const secret = integrationSecret(integration.config);
    if (!secret || !verifyInboundSignature(raw, signature, secret)) {
      logSecurity("webhook.invalid_signature", { provider: "whatsapp", integrationId: integration.id });
      return unauthorized("Invalid signature");
    }

    const messages = parseMetaWhatsAppPayload(payload);
    if (messages.length === 0) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const results = [];
    for (const message of messages) {
      results.push(
        await handleInboundWhatsApp({
          organizationId: integration.organizationId,
          phone: message.phone,
          body: message.body,
          providerId: message.providerId,
          contactName: message.contactName,
        }),
      );
    }
    return NextResponse.json({ ok: true, results });
  }

  const integrationId = inboundIntegrationId(request);
  if (!integrationId) {
    logSecurity("webhook.unknown_integration", { provider: "inbound" });
    return unauthorized("Unknown integration");
  }
  const integration = await resolveIntegrationById(integrationId, ["WEBHOOK", "N8N", "WHATSAPP"]);
  if (!integration) {
    logSecurity("webhook.unknown_integration", { provider: "inbound" });
    return unauthorized("Unknown integration");
  }
  if (!signature) {
    logSecurity("webhook.missing_signature", { provider: "inbound", integrationId: integration.id });
    return unauthorized("Missing signature");
  }
  const secret = integrationSecret(integration.config);
  if (!secret || !verifyInboundSignature(raw, signature, secret)) {
    logSecurity("webhook.invalid_signature", { provider: "inbound", integrationId: integration.id });
    return unauthorized("Invalid signature");
  }

  const parsed = customSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const phone = parsed.data.phone ?? parsed.data.from ?? "";
  const body = parsed.data.body ?? parsed.data.text ?? "";
  const eventId = customInboundEventId(parsed.data);
  const result = await handleInboundWhatsApp({
    organizationId: integration.organizationId,
    phone,
    body,
    providerId: eventId || undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Unable to store inbound message" }, { status: 400 });
  }
  if (eventId && !result.duplicate) {
    await claimWebhookEvent("inbound", `${integration.organizationId}:${eventId}`);
  }
  return NextResponse.json({
    ok: true,
    leadId: result.leadId,
    created: result.created,
    duplicate: result.duplicate ?? false,
  });
}
