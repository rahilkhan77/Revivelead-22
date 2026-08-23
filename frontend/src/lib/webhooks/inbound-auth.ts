import { verifyMetaSignature } from "@/lib/whatsapp/inbound";

export function inboundSignatureHeader(request: Request) {
  return request.headers.get("x-revivelead-signature") ?? request.headers.get("x-hub-signature-256");
}

export function inboundIntegrationId(request: Request) {
  return request.headers.get("x-revivelead-integration")?.trim() ?? "";
}

export function verifyInboundSignature(rawBody: string, signature: string | null, secret: string) {
  return verifyMetaSignature(rawBody, signature, secret);
}

export function customInboundEventId(payload: {
  eventId?: string;
  id?: string;
  providerId?: string;
}) {
  return (payload.eventId ?? payload.providerId ?? payload.id ?? "").trim();
}
