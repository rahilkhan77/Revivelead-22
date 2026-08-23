"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  cancelSubscriptionAction,
  openBillingPortalAction,
  resumeSubscriptionAction,
  startCheckoutAction,
  verifyRazorpayCheckoutAction,
} from "@/actions/billing";
import { changePlanAction } from "@/actions/settings";
import { openPaddleCheckout } from "@/components/paddle-checkout";
import { openRazorpayCheckout } from "@/components/razorpay-checkout";
import { Button } from "@/components/ui/button";
import type { PlanDefinition } from "@/lib/billing/plans";
import { toast } from "sonner";

export function BillingPlans({
  plans,
  current,
  currentStatus,
  isOwner,
  seats,
  leadLimit,
  provider,
  hasLiveSubscription,
  canResume,
}: {
  plans: PlanDefinition[];
  current: string;
  currentStatus: string;
  isOwner: boolean;
  seats: number;
  leadLimit: number;
  provider: "razorpay" | "paddle" | "none";
  hasLiveSubscription: boolean;
  canResume: boolean;
}) {
  const router = useRouter();
  const live = provider !== "none";
  const [pending, setPending] = useState(false);

  return (
    <div>
      <p className="mb-6 text-sm text-muted-foreground">
        Current envelope: {seats} seats · {leadLimit} active leads.{" "}
        {provider === "razorpay"
          ? "Razorpay is the live billing provider. Plan access updates only after server-side payment verification."
          : provider === "paddle"
            ? "Paddle is the Merchant of Record. Subscription state is updated from verified webhooks."
            : "A live billing provider is not configured yet, so the owner can switch plans locally."}{" "}
        The Al Noor demo is never billed.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = current === plan.id && currentStatus !== "CANCELED";
          const isUpgrade = (plan.priceMonthly || 0) > (plans.find((item) => item.id === current)?.priceMonthly || 0);
          const label = isCurrent
            ? "Current plan"
            : !plan.priceMonthly
              ? "Talk to us"
              : isUpgrade
                ? `Upgrade to ${plan.name}`
                : `Switch to ${plan.name}`;
          return (
            <div key={plan.id} className="rounded-lg border border-border p-5">
              <p className="text-sm text-muted-foreground">{plan.name}</p>
              <p className="mt-2 text-2xl font-medium">
                {plan.priceMonthly ? `$${plan.priceMonthly}/mo` : "Custom"}
              </p>
              <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Button
                className="mt-5"
                variant={isCurrent ? "secondary" : "default"}
                disabled={!isOwner || isCurrent || pending}
                onClick={async () => {
                  if (!plan.priceMonthly) {
                    router.push("/contact");
                    return;
                  }
                  if (pending) return;
                  setPending(true);
                  try {
                    const form = new FormData();
                    form.set("plan", plan.id);
                    const checkout = await startCheckoutAction(form);
                    if (checkout.ok && checkout.data?.planUpdated) {
                      toast.success("Plan change sent to Razorpay. Access updates after confirmation.");
                      router.refresh();
                      return;
                    }
                    if (checkout.ok && checkout.data?.subscriptionId && checkout.data.keyId) {
                      try {
                        const response = await openRazorpayCheckout({
                          keyId: checkout.data.keyId,
                          subscriptionId: checkout.data.subscriptionId,
                          name: checkout.data.name,
                          description: checkout.data.description,
                          prefillName: checkout.data.prefillName,
                          prefillEmail: checkout.data.prefillEmail,
                        });
                        const verify = new FormData();
                        verify.set("razorpay_payment_id", response.razorpay_payment_id);
                        verify.set("razorpay_subscription_id", response.razorpay_subscription_id);
                        verify.set("razorpay_signature", response.razorpay_signature);
                        const verified = await verifyRazorpayCheckoutAction(verify);
                        if (!verified.ok) {
                          toast.error(verified.error ?? "Payment could not be verified.");
                          return;
                        }
                        if (verified.data?.confirmed) {
                          toast.success("Payment confirmed. Your plan is active.");
                        } else {
                          toast.message("Checkout finished, but payment is not confirmed yet.");
                        }
                        router.refresh();
                      } catch (error) {
                        if (error instanceof Error && error.message === "CHECKOUT_DISMISSED") return;
                        toast.error(error instanceof Error ? error.message : "Unable to open Razorpay checkout.");
                      }
                      return;
                    }
                    if (checkout.ok && checkout.data?.url) {
                      window.location.href = checkout.data.url;
                      return;
                    }
                    if (checkout.ok && checkout.data?.transactionId && checkout.data.clientToken) {
                      try {
                        await openPaddleCheckout({
                          transactionId: checkout.data.transactionId,
                          clientToken: checkout.data.clientToken,
                          environment: checkout.data.environment ?? "sandbox",
                        });
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Unable to open Paddle checkout.");
                      }
                      return;
                    }
                    if (live) {
                      toast.error(checkout.error ?? "Unable to start checkout.");
                      return;
                    }
                    const result = await changePlanAction(form);
                    if (!result.ok) toast.error(checkout.error ?? result.error);
                    else {
                      toast.success(`Moved to ${plan.name}`);
                      router.refresh();
                    }
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {label}
              </Button>
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {provider === "paddle" ? (
          <Button
            variant="outline"
            disabled={!isOwner}
            onClick={async () => {
              const result = await openBillingPortalAction();
              if (!result.ok) toast.error(result.error);
              else if (result.data?.url) window.location.href = result.data.url;
            }}
          >
            Manage billing
          </Button>
        ) : null}
        {canResume ? (
          <Button
            variant="outline"
            disabled={!isOwner}
            onClick={async () => {
              const result = await resumeSubscriptionAction();
              if (!result.ok) toast.error(result.error);
              else {
                toast.success("Resume requested. Status updates after Razorpay confirms.");
                router.refresh();
              }
            }}
          >
            Resume subscription
          </Button>
        ) : null}
        <Button
          variant="ghost"
          disabled={!isOwner || !hasLiveSubscription}
          onClick={async () => {
            if (!window.confirm("Cancel this subscription at the end of the current billing period?")) return;
            const result = await cancelSubscriptionAction();
            if (!result.ok) toast.error(result.error);
            else {
              toast.success("Cancellation requested. Access continues until the period ends.");
              router.refresh();
            }
          }}
        >
          Cancel subscription
        </Button>
      </div>
    </div>
  );
}
