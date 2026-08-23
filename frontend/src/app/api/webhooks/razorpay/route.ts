import { NextResponse } from "next/server";
import { billingAuditActionForEvent, isRecognizedRazorpayEvent, writeBillingAudit } from "@/lib/billing/events";
import {
  applyRazorpaySnapshot,
  isRazorpayWebhookConfigured,
  isStaleRazorpayEvent,
  markRazorpayPastDue,
  notesRecord,
  parseRazorpayWebhook,
  razorpayWebhookEventId,
  verifyRazorpayWebhookSignature,
  type RazorpaySubscriptionSnapshot,
} from "@/lib/billing/razorpay";
import { db } from "@/lib/db";
import { oversizedResponse, payloadTooLarge, tooManyRequests } from "@/lib/http";
import { logSecurity } from "@/lib/log";
import { clientKey, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { claimWebhookEvent } from "@/lib/webhooks/idempotency";

export async function POST(request: Request) {
  const limited = await rateLimit(clientKey(request, "razorpay-webhook"), "webhook");
  if (!limited.ok) return tooManyRequests(retryAfterSeconds(limited));

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret || !isRazorpayWebhookConfigured()) {
    return NextResponse.json({ error: "Razorpay webhook is not configured" }, { status: 503 });
  }
  if (payloadTooLarge(request)) {
    return NextResponse.json(oversizedResponse(), { status: 413 });
  }

  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature) {
    logSecurity("webhook.missing_signature", { provider: "billing" });
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  if (!verifyRazorpayWebhookSignature(raw, signature, secret)) {
    logSecurity("webhook.invalid_signature", { provider: "billing" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = parseRazorpayWebhook(raw);
  if (!event?.event) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  if (isStaleRazorpayEvent(event.created_at)) {
    logSecurity("webhook.stale", { provider: "billing" });
    return NextResponse.json({ error: "Stale event" }, { status: 400 });
  }
  if (!isRecognizedRazorpayEvent(event.event)) {
    return NextResponse.json({ ok: true, ignored: true, reason: "unknown_event" });
  }

  const headerEventId =
    request.headers.get("x-razorpay-event-id") ?? request.headers.get("x-razorpay-eventid");
  const eventId = razorpayWebhookEventId(headerEventId, event);
  if (!(await claimWebhookEvent("razorpay", eventId))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const subscription = event.payload?.subscription?.entity;
  const payment = event.payload?.payment?.entity;
  const organizationId = await resolveOrganizationId(subscription, payment?.notes);
  if (!organizationId) return NextResponse.json({ ok: true, ignored: true });

  if (event.event === "payment.failed") {
    if (subscription?.id) {
      await applyRazorpaySnapshot(organizationId, { ...subscription, status: "halted" });
    } else {
      await markRazorpayPastDue(organizationId);
    }
  } else if (subscription?.id) {
    await applyRazorpaySnapshot(organizationId, subscription);
  }

  await writeBillingAudit({
    organizationId,
    action: billingAuditActionForEvent(event.event),
    entityId: subscription?.id ?? payment?.id ?? null,
    metadata: { event: event.event },
  });

  return NextResponse.json({ ok: true });
}

async function resolveOrganizationId(
  subscription: RazorpaySubscriptionSnapshot | undefined,
  paymentNotes: unknown,
) {
  if (subscription?.id) {
    const bySub = await db.subscription.findFirst({
      where: { provider: "razorpay", providerSubId: subscription.id },
      select: { organizationId: true },
    });
    if (bySub) return bySub.organizationId;
  }

  if (subscription?.customer_id) {
    const byCustomer = await db.subscription.findFirst({
      where: { provider: "razorpay", providerCustomerId: subscription.customer_id },
      select: { organizationId: true },
    });
    if (byCustomer) return byCustomer.organizationId;
  }

  const fromNotes =
    notesRecord(subscription?.notes).organizationId || notesRecord(paymentNotes).organizationId;
  if (!fromNotes) return null;
  const org = await db.organization.findUnique({ where: { id: fromNotes }, select: { id: true } });
  return org?.id ?? null;
}
