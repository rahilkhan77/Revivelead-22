import type { AppUser } from "@/lib/auth/provision-clerk";
import { appUrl } from "@/lib/app-url";
import { writeBillingAudit } from "@/lib/billing/events";
import { billingPlanSchema } from "@/lib/billing/plans";
import { getPaymentProvider, isBillingProviderEnabled } from "@/lib/billing/provider";
import { db } from "@/lib/db";
import { billingFail, billingOk, type BillingResult } from "@/lib/billing/result";
import type { PaymentCheckoutResult } from "@/lib/providers/types";

export function resolveCheckoutIntent(
  user: Pick<AppUser, "organizationId" | "role">,
  input: { plan?: unknown; amount?: unknown; currency?: unknown; organizationId?: unknown },
) {
  if (user.role !== "OWNER") return billingFail("Only the owner can change billing.");
  const parsedPlan = billingPlanSchema.safeParse(input.plan);
  if (!parsedPlan.success) return billingFail("Invalid plan.");
  return billingOk({
    plan: parsedPlan.data,
    organizationId: user.organizationId,
  });
}

export async function createAgencyCheckout(
  user: AppUser,
  input: { plan?: unknown; amount?: unknown; currency?: unknown; organizationId?: unknown },
): Promise<BillingResult<PaymentCheckoutResult>> {
  const intent = resolveCheckoutIntent(user, input);
  if (!intent.ok || !intent.data) return billingFail(intent.error ?? "Invalid plan.");

  const org = await db.organization.findUnique({ where: { id: user.organizationId } });
  if (!org) return billingFail("Agency not found.");
  if (org.isDemo) return billingFail("The Al Noor demo tenant is not billed.");
  if (!isBillingProviderEnabled()) {
    return billingFail("Billing is not configured. Set Razorpay server keys before starting checkout.");
  }

  const checkout = await getPaymentProvider().createCheckout({
    organizationId: org.id,
    organizationName: org.name,
    email: user.email,
    plan: intent.data.plan,
    successUrl: `${appUrl()}/billing`,
    cancelUrl: `${appUrl()}/billing`,
  });

  await writeBillingAudit({
    organizationId: org.id,
    userId: user.id,
    action: "billing.order.created",
    entityId: checkout.subscriptionId ?? null,
    metadata: { plan: intent.data.plan },
  });

  if (
    checkout.planUpdated ||
    (checkout.subscriptionId && checkout.keyId) ||
    checkout.url ||
    checkout.transactionId
  ) {
    return billingOk(checkout);
  }
  return billingFail("Checkout could not be created.");
}
