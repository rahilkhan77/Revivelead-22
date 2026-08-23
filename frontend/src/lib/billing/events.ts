import { writeAudit } from "@/lib/audit";

export const RAZORPAY_RECOGNIZED_EVENTS = [
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.completed",
  "subscription.updated",
  "subscription.paused",
  "subscription.resumed",
  "payment.failed",
  "payment.captured",
] as const;

export type RazorpayRecognizedEvent = (typeof RAZORPAY_RECOGNIZED_EVENTS)[number];

export function isRecognizedRazorpayEvent(event?: string | null): event is RazorpayRecognizedEvent {
  return Boolean(event && (RAZORPAY_RECOGNIZED_EVENTS as readonly string[]).includes(event));
}

export function billingAuditActionForEvent(event: string) {
  if (event === "subscription.activated" || event === "subscription.authenticated") {
    return "billing.subscription.activated";
  }
  if (event === "subscription.charged") return "billing.subscription.renewed";
  if (event === "payment.failed" || event === "subscription.halted" || event === "subscription.pending") {
    return "billing.payment.failed";
  }
  if (event === "subscription.cancelled" || event === "subscription.completed") {
    return "billing.subscription.cancelled";
  }
  return "billing.webhook.processed";
}

export async function writeBillingAudit(input: {
  organizationId: string;
  userId?: string | null;
  action: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: input.action,
    entity: "Subscription",
    entityId: input.entityId,
    metadata: input.metadata ?? {},
  });
}
