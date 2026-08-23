import type { Plan } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

export type PlanDefinition = {
  id: Plan;
  name: string;
  priceMonthly: number;
  currency: string;
  description: string;
  leadLimit: number;
  seats: number;
  automationLimit: number;
  whatsappMonthlyLimit: number;
  features: string[];
};

export const PLANS: PlanDefinition[] = [
  {
    id: "STARTER",
    name: "Starter",
    priceMonthly: 199,
    currency: "USD",
    description: "For boutique brokerages getting control of follow-ups.",
    leadLimit: 100,
    seats: 3,
    automationLimit: 5,
    whatsappMonthlyLimit: 200,
    features: [
      "100 active leads",
      "3 seats",
      "5 automations",
      "200 WhatsApp sends / month",
      "AI qualification",
      "Follow-up engine",
    ],
  },
  {
    id: "PRO",
    name: "Pro",
    priceMonthly: 499,
    currency: "USD",
    description: "For growing agencies recovering dormant pipeline.",
    leadLimit: 2000,
    seats: 15,
    automationLimit: 25,
    whatsappMonthlyLimit: 2000,
    features: [
      "2,000 active leads",
      "15 seats",
      "25 automations",
      "2,000 WhatsApp sends / month",
      "Reactivation campaigns",
      "Revenue recovery dashboard",
    ],
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    priceMonthly: 0,
    currency: "USD",
    description: "For multi-branch groups across Dubai, Qatar and India.",
    leadLimit: 100000,
    seats: 250,
    automationLimit: 250,
    whatsappMonthlyLimit: 50000,
    features: [
      "Unlimited leads",
      "Custom seats",
      "High-volume WhatsApp",
      "CRM + n8n connectors",
      "Dedicated success manager",
      "Custom contract + dedicated billing",
    ],
  },
];

export const billingPlanSchema = z.enum(["STARTER", "PRO"]);

export function getPlan(plan: Plan) {
  return PLANS.find((item) => item.id === plan) ?? PLANS[0];
}

export async function getBillingUsage(organizationId: string) {
  const [subscription, activeLeads, seatsUsed, automations] = await Promise.all([
    db.subscription.findUnique({
      where: { organizationId },
    }),
    db.lead.count({
      where: { organizationId, status: { notIn: ["WON", "LOST"] } },
    }),
    db.membership.count({ where: { organizationId } }),
    db.automation.count({ where: { organizationId } }),
  ]);
  const whatsappSent = subscription?.whatsappSentThisPeriod ?? 0;

  return {
    plan: subscription?.plan ?? "STARTER",
    status: subscription?.status ?? "TRIALING",
    billingPeriod: subscription?.billingPeriod ?? "month",
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    activeLeads,
    leadLimit: subscription?.leadLimit ?? 100,
    seatsUsed,
    seats: subscription?.seats ?? 3,
    automations,
    automationLimit: subscription?.automationLimit ?? 5,
    whatsappSent,
    whatsappMonthlyLimit: subscription?.whatsappMonthlyLimit ?? 200,
  };
}

export function isUnpaidSubscription(status: string | null | undefined) {
  return status === "CANCELED";
}

export async function assertWithinLeadLimit(organizationId: string) {
  const usage = await getBillingUsage(organizationId);
  if (usage.activeLeads >= usage.leadLimit) {
    throw new Error(
      `Lead limit reached for the ${usage.plan} plan (${usage.leadLimit} active leads). Upgrade to add more.`,
    );
  }
}

export async function assertWithinSeatLimit(organizationId: string) {
  const usage = await getBillingUsage(organizationId);
  if (usage.seatsUsed >= usage.seats) {
    throw new Error(`Seat limit reached (${usage.seats}). Upgrade your plan to invite more teammates.`);
  }
}

export async function assertWithinAutomationLimit(organizationId: string) {
  const usage = await getBillingUsage(organizationId);
  if (usage.automations >= usage.automationLimit) {
    throw new Error(
      `Automation limit reached (${usage.automationLimit}). Upgrade your plan to add more automations.`,
    );
  }
}

export async function assertWithinWhatsAppLimit(organizationId: string) {
  const usage = await getBillingUsage(organizationId);
  if (usage.whatsappSent >= usage.whatsappMonthlyLimit) {
    throw new Error(
      `WhatsApp monthly limit reached (${usage.whatsappMonthlyLimit}). Upgrade your plan to send more messages.`,
    );
  }
}

export async function incrementWhatsAppUsage(organizationId: string) {
  await db.subscription.updateMany({
    where: { organizationId },
    data: { whatsappSentThisPeriod: { increment: 1 } },
  });
}
