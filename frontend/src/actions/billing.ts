"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { appUrl } from "@/lib/app-url";
import { createAgencyCheckout } from "@/lib/billing/checkout";
import { writeBillingAudit } from "@/lib/billing/events";
import { isPaddleEnabled } from "@/lib/billing/paddle";
import { getPaymentProvider, isBillingProviderEnabled } from "@/lib/billing/provider";
import { fetchRazorpaySubscription, isRazorpayEnabled } from "@/lib/billing/razorpay";
import { confirmRazorpayCheckout } from "@/lib/billing/verify";
import { db } from "@/lib/db";
import { fail, ok, toErrorMessage, withUser } from "@/lib/safe-action";

const razorpayPaymentSchema = z.object({
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpay_subscription_id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
  razorpay_signature: z.string().min(32).max(128),
});

export async function startCheckoutAction(formData: FormData) {
  try {
    const user = await withUser({ policy: "billing" });
    const result = await createAgencyCheckout(user, {
      plan: String(formData.get("plan") ?? ""),
      amount: formData.get("amount"),
      currency: formData.get("currency"),
      organizationId: formData.get("organizationId"),
    });
    if (!result.ok || !result.data) return fail(result.error ?? "Checkout could not be created.");
    return ok({
      ...result.data,
      successUrl: `${appUrl()}/billing`,
      cancelUrl: `${appUrl()}/billing`,
    });
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function verifyRazorpayCheckoutAction(formData: FormData) {
  try {
    const user = await withUser({ policy: "billing" });
    if (user.role !== "OWNER") return fail("Only the owner can change billing.");
    const org = await db.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    if (org.isDemo) return fail("The Al Noor demo tenant is not billed.");
    if (!isRazorpayEnabled()) return fail("Razorpay is not configured.");

    const parsed = razorpayPaymentSchema.safeParse({
      razorpay_payment_id: String(formData.get("razorpay_payment_id") ?? "").trim(),
      razorpay_subscription_id: String(formData.get("razorpay_subscription_id") ?? "").trim(),
      razorpay_signature: String(formData.get("razorpay_signature") ?? "").trim(),
    });
    if (!parsed.success) return fail("Payment could not be verified.");

    const secret = process.env.RAZORPAY_KEY_SECRET?.trim() ?? "";
    const live = await fetchRazorpaySubscription(parsed.data.razorpay_subscription_id);
    const result = await confirmRazorpayCheckout({
      organizationId: user.organizationId,
      userId: user.id,
      paymentId: parsed.data.razorpay_payment_id,
      subscriptionId: parsed.data.razorpay_subscription_id,
      signature: parsed.data.razorpay_signature,
      secret,
      liveSubscription: live,
    });
    revalidatePath("/billing");
    revalidatePath("/settings");
    if (!result.ok || !result.data) return fail(result.error ?? "Payment could not be verified.");
    return ok(result.data);
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function openBillingPortalAction() {
  try {
    const user = await withUser({ policy: "billing" });
    if (user.role !== "OWNER") return fail("Only the owner can manage billing.");
    const org = await db.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    if (org.isDemo) return fail("The Al Noor demo tenant is not billed.");
    if (isRazorpayEnabled()) {
      return fail("Razorpay billing is managed in ReviveLead. Use change plan, cancel, or resume on this page.");
    }
    const subscription = await db.subscription.findUnique({ where: { organizationId: user.organizationId } });
    if (!subscription?.providerCustomerId || !isPaddleEnabled()) {
      return fail("No Paddle customer is attached to this agency yet.");
    }
    const portal = await getPaymentProvider().createPortalSession({
      customerId: subscription.providerCustomerId,
      subscriptionId: subscription.providerSubId,
    });
    return ok({ url: portal.url });
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function cancelSubscriptionAction() {
  try {
    const user = await withUser({ policy: "billing" });
    if (user.role !== "OWNER") return fail("Only the owner can cancel billing.");
    const org = await db.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    if (org.isDemo) return fail("The Al Noor demo tenant is not billed.");
    const subscription = await db.subscription.findUnique({ where: { organizationId: user.organizationId } });
    if (!subscription?.providerSubId || !isBillingProviderEnabled()) {
      return fail("No live subscription is attached to this agency.");
    }
    const provider = getPaymentProvider();
    await provider.cancelSubscription(subscription.providerSubId);
    await writeBillingAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "billing.subscription.cancelled",
      entityId: subscription.providerSubId,
      metadata: { pendingWebhook: true },
    });
    if (isRazorpayEnabled() && subscription.provider === "razorpay") {
      try {
        const live = await fetchRazorpaySubscription(subscription.providerSubId);
        const { applyRazorpaySnapshot } = await import("@/lib/billing/razorpay");
        await applyRazorpaySnapshot(user.organizationId, live);
      } catch {
        revalidatePath("/billing");
        return ok({ pendingWebhook: true });
      }
    }
    revalidatePath("/billing");
    return ok({ pendingWebhook: true });
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function resumeSubscriptionAction() {
  try {
    const user = await withUser({ policy: "billing" });
    if (user.role !== "OWNER") return fail("Only the owner can resume billing.");
    const org = await db.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    if (org.isDemo) return fail("The Al Noor demo tenant is not billed.");
    if (!isRazorpayEnabled()) return fail("Resume is available for Razorpay subscriptions.");
    const subscription = await db.subscription.findUnique({ where: { organizationId: user.organizationId } });
    if (!subscription?.providerSubId || subscription.provider !== "razorpay") {
      return fail("No live Razorpay subscription is attached to this agency.");
    }
    const provider = getPaymentProvider();
    if (!provider.resumeSubscription) return fail("This billing provider cannot resume subscriptions.");
    await provider.resumeSubscription(subscription.providerSubId);
    const { applyRazorpaySnapshot, fetchRazorpaySubscription: fetchLive } = await import("@/lib/billing/razorpay");
    const live = await fetchLive(subscription.providerSubId);
    await applyRazorpaySnapshot(user.organizationId, live);
    revalidatePath("/billing");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}
