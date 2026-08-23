import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { resolveIntegrationByPhoneNumberId } from "@/lib/integrations/lookup";
import { ingestLead, receiveLeadReply } from "@/lib/leads/service";
import { normalizePhone } from "@/lib/leads/normalize";
import { parseWhatsAppConfig, webhookSecretOf } from "@/lib/whatsapp/config";

export type InboundResult = {
  ok: boolean;
  leadId?: string;
  created?: boolean;
  duplicate?: boolean;
  error?: string;
};

export function verifyMetaSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  const hex = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const left = Buffer.from(hex);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isMetaWhatsAppPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  return (payload as { object?: unknown }).object === "whatsapp_business_account";
}

export function metaPhoneNumberId(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as {
    entry?: { changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[];
  };
  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id?.trim();
      if (id) return id;
    }
  }
  return null;
}

export async function resolveOrgFromPhoneNumberId(phoneNumberId?: string | null) {
  const integration = await resolveIntegrationByPhoneNumberId(phoneNumberId);
  return integration?.organizationId ?? null;
}

export async function handleInboundWhatsApp(input: {
  organizationId: string;
  phone: string;
  body: string;
  providerId?: string;
  contactName?: string;
}): Promise<InboundResult> {
  const body = input.body.trim().slice(0, 4000);
  const phone = input.phone.trim();
  if (!phone || !body) return { ok: false, error: "phone and body are required" };

  if (input.providerId) {
    const existingMessage = await db.leadMessage.findFirst({
      where: { organizationId: input.organizationId, providerId: input.providerId },
    });
    if (existingMessage) {
      return { ok: true, leadId: existingMessage.leadId, duplicate: true };
    }
  }

  const digits = normalizePhone(phone);
  const lead = digits
    ? await db.lead.findFirst({
        where: { organizationId: input.organizationId, phoneNormalized: digits },
      })
    : null;

  if (lead) {
    await receiveLeadReply({
      organizationId: input.organizationId,
      leadId: lead.id,
      body,
      channel: "WHATSAPP",
      providerId: input.providerId,
    });
    return { ok: true, leadId: lead.id, created: false };
  }

  const created = await ingestLead({
    organizationId: input.organizationId,
    name: input.contactName?.trim() || `WhatsApp ${phone}`,
    phone,
    source: "WhatsApp",
    notes: body,
  });

  await db.leadMessage.create({
    data: {
      organizationId: input.organizationId,
      leadId: created.id,
      direction: "INBOUND",
      channel: "WHATSAPP",
      body,
      providerId: input.providerId,
    },
  });

  return { ok: true, leadId: created.id, created: true };
}

export type MetaInboundMessage = {
  phoneNumberId?: string;
  phone: string;
  body: string;
  providerId?: string;
  contactName?: string;
};

export function parseMetaWhatsAppPayload(payload: unknown): MetaInboundMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as {
    object?: string;
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          contacts?: { profile?: { name?: string }; wa_id?: string }[];
          messages?: {
            from?: string;
            id?: string;
            type?: string;
            text?: { body?: string };
          }[];
        };
      }[];
    }[];
  };
  if (root.object && root.object !== "whatsapp_business_account") return [];

  const messages: MetaInboundMessage[] = [];
  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const contactName = value?.contacts?.[0]?.profile?.name;
      for (const message of value?.messages ?? []) {
        const body = message.text?.body ?? "";
        if (!message.from || !body) continue;
        messages.push({
          phoneNumberId,
          phone: message.from,
          body,
          providerId: message.id,
          contactName,
        });
      }
    }
  }
  return messages;
}

export function webhookSecretFromConfig(raw: string | null | undefined) {
  return webhookSecretOf(parseWhatsAppConfig(raw));
}
