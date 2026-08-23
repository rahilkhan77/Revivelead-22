import { writeBillingAudit } from "@/lib/billing/events";
import {
  applyRazorpaySnapshot,
  notesRecord,
  verifyRazorpayPaymentSignature,
  type RazorpaySubscriptionSnapshot,
} from "@/lib/billing/razorpay";
import { billingFail, billingOk, type BillingResult } from "@/lib/billing/result";
import { db } from "@/lib/db";
import { logSecurity } from "@/lib/log";

export async function confirmRazorpayCheckout(input: {
  organizationId: string;
  userId: string;
  paymentId: string;
  subscriptionId: string;
  signature: string;
  secret: string;
  liveSubscription: RazorpaySubscriptionSnapshot;
}): Promise<BillingResult<{ status: string; confirmed: boolean }>> {
  if (!verifyRazorpayPaymentSignature({
    paymentId: input.paymentId,
    subscriptionId: input.subscriptionId,
    signature: input.signature,
    secret: input.secret,
  })) {
    logSecurity("billing.suspicious", { reason: "invalid_checkout_signature" });
    return billingFail("Payment could not be verified.");
  }

  const notes = notesRecord(input.liveSubscription.notes);
  const attached = await db.subscription.findFirst({
    where: {
      organizationId: input.organizationId,
      provider: "razorpay",
      providerSubId: input.subscriptionId,
    },
    select: { id: true },
  });
  if (!attached || (notes.organizationId && notes.organizationId !== input.organizationId)) {
    logSecurity("billing.suspicious", { reason: "subscription_org_mismatch" });
    return billingFail("This subscription does not belong to your agency.");
  }

  await applyRazorpaySnapshot(input.organizationId, input.liveSubscription);
  const subscription = await db.subscription.findUnique({
    where: { organizationId: input.organizationId },
    select: { status: true },
  });
  await writeBillingAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "billing.payment.verified",
    entityId: input.subscriptionId,
    metadata: { paymentId: input.paymentId, status: subscription?.status ?? "TRIALING" },
  });
  if (subscription?.status === "ACTIVE") {
    await writeBillingAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "billing.subscription.activated",
      entityId: input.subscriptionId,
      metadata: { source: "live_fetch" },
    });
  }

  return billingOk({
    status: subscription?.status ?? "TRIALING",
    confirmed: subscription?.status === "ACTIVE",
  });
}
