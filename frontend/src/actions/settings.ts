"use server";

import { revalidatePath } from "next/cache";
import type { Plan } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { getPlan } from "@/lib/billing/plans";
import { ADMIN_ROLES, DEFAULT_ORG_SETTINGS, type OrgSettings } from "@/lib/constants";
import { db } from "@/lib/db";
import { parseJson } from "@/lib/format";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { stampSecretFingerprint } from "@/lib/integrations/lookup";
import { looksMasked, parseWhatsAppConfig } from "@/lib/whatsapp/config";
import { fail, ok, toErrorMessage, withUser } from "@/lib/safe-action";

export async function updateOrganizationAction(formData: FormData) {
  try {
    const user = await withUser();
    if (!ADMIN_ROLES.includes(user.role)) return fail("Admin access required.");
    const name = String(formData.get("name") ?? "").trim().slice(0, 120);
    const market = String(formData.get("market") ?? "Dubai").trim().slice(0, 80);
    const country = String(formData.get("country") ?? "UAE").trim().slice(0, 80);
    const timezone = String(formData.get("timezone") ?? "Asia/Dubai").trim().slice(0, 80);
    const currency = String(formData.get("currency") ?? "AED").trim().slice(0, 8);
    if (name.length < 2) return fail("Organization name is required.");
    await db.organization.update({
      where: { id: user.organizationId },
      data: { name, market, country, timezone, currency },
    });
    revalidatePath("/settings");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function updateOrgSettingsAction(formData: FormData) {
  try {
    const user = await withUser();
    if (!ADMIN_ROLES.includes(user.role)) return fail("Admin access required.");
    const org = await db.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
    });
    const parsed = parseJson<Partial<OrgSettings>>(org.settings, {});
    const current: OrgSettings = {
      ...DEFAULT_ORG_SETTINGS,
      ...parsed,
      followUp: {
        ...DEFAULT_ORG_SETTINGS.followUp,
        ...parsed.followUp,
        templates: {
          ...DEFAULT_ORG_SETTINGS.followUp.templates,
          ...parsed.followUp?.templates,
        },
      },
    };
    const next: OrgSettings = {
      ...current,
      followUp: {
        ...current.followUp,
        immediateResponseMinutes: Number(formData.get("immediateResponseMinutes") ?? 0),
        firstFollowUpHours: Number(formData.get("firstFollowUpHours") ?? 24),
        secondFollowUpHours: Number(formData.get("secondFollowUpHours") ?? 72),
        agentAlertHours: Number(formData.get("agentAlertHours") ?? 168),
        dormantDays: Number(formData.get("dormantDays") ?? 30),
        businessHoursStart: Number(formData.get("businessHoursStart") ?? 9),
        businessHoursEnd: Number(formData.get("businessHoursEnd") ?? 19),
        respectBusinessHours: formData.get("respectBusinessHours") === "on",
        templates: {
          ...current.followUp.templates,
          immediate: String(formData.get("templateImmediate") ?? current.followUp.templates.immediate),
          day1: String(formData.get("templateDay1") ?? current.followUp.templates.day1),
          day3: String(formData.get("templateDay3") ?? current.followUp.templates.day3),
          day7: String(formData.get("templateDay7") ?? current.followUp.templates.day7),
        },
      },
      ai: {
        ...current.ai,
        model: String(formData.get("model") ?? current.ai.model),
        autoQualify: formData.get("autoQualify") === "on",
        suggestReplies: formData.get("suggestReplies") === "on",
      },
      notifications: {
        email: formData.get("emailNotifications") === "on",
        inApp: formData.get("inAppNotifications") === "on",
        agentAlerts: formData.get("agentAlerts") === "on",
      },
    };
    await db.organization.update({
      where: { id: user.organizationId },
      data: { settings: JSON.stringify(next) },
    });
    revalidatePath("/settings");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function updateIntegrationAction(formData: FormData) {
  try {
    const user = await withUser();
    if (!ADMIN_ROLES.includes(user.role)) return fail("Admin access required.");
    const id = String(formData.get("id") ?? "");
    const integration = await db.integration.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!integration) return fail("Integration not found.");
    const existing = parseWhatsAppConfig(integration.config);
    const incomingToken = String(formData.get("accessToken") ?? "");
    const incomingSecret = String(formData.get("secret") ?? formData.get("webhookSecret") ?? "");
    const updated = await db.integration.updateMany({
      where: { id, organizationId: user.organizationId },
      data: {
        enabled: formData.get("enabled") === "on",
        config: JSON.stringify(
          stampSecretFingerprint({
            accessToken: looksMasked(incomingToken) ? existing.accessToken ?? "" : incomingToken,
            phoneNumberId: String(formData.get("phoneNumberId") ?? existing.phoneNumberId ?? ""),
            businessAccountId: String(formData.get("businessAccountId") ?? existing.businessAccountId ?? ""),
            fromNumber: String(formData.get("fromNumber") ?? existing.fromNumber ?? ""),
            smtpHost: String(formData.get("smtpHost") ?? ""),
            smtpUser: String(formData.get("smtpUser") ?? ""),
            fromEmail: String(formData.get("fromEmail") ?? ""),
            url: String(formData.get("url") ?? ""),
            secret: looksMasked(incomingSecret) ? existing.secret ?? existing.webhookSecret ?? "" : incomingSecret,
            webhookSecret: looksMasked(incomingSecret) ? existing.webhookSecret ?? existing.secret ?? "" : incomingSecret,
          }),
        ),
      },
    });
    if (updated.count === 0) return fail("Integration not found.");
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "integration.updated",
      entity: "Integration",
      entityId: id,
    });
    revalidatePath("/settings");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function changePlanAction(formData: FormData) {
  try {
    const user = await withUser();
    if (user.role !== "OWNER") return fail("Only the owner can change billing.");
    const org = await db.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const { isPaddleEnabled } = await import("@/lib/billing/paddle");
    const { isRazorpayEnabled } = await import("@/lib/billing/razorpay");
    if ((isRazorpayEnabled() || isPaddleEnabled()) && !org.isDemo) {
      return fail("Live plan changes go through checkout. Use Upgrade on the billing page.");
    }
    const plan = String(formData.get("plan") ?? "STARTER") as Plan;
    const definition = getPlan(plan);
    await db.subscription.update({
      where: { organizationId: user.organizationId },
      data: {
        plan,
        status: "ACTIVE",
        seats: definition.seats,
        leadLimit: definition.leadLimit,
        automationLimit: definition.automationLimit,
        whatsappMonthlyLimit: definition.whatsappMonthlyLimit,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    revalidatePath("/billing");
    revalidatePath("/settings");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function sendWhatsAppTestAction(formData: FormData) {
  try {
    const user = await withUser();
    if (!ADMIN_ROLES.includes(user.role)) return fail("Admin access required.");
    const to = String(formData.get("to") ?? "").trim();
    if (!to) return fail("Enter a phone number to send the test message.");
    if (String(formData.get("confirm") ?? "") !== "yes") {
      return fail("Confirm that you want to send a live WhatsApp test message.");
    }
    const result = await getMessagingProvider("WHATSAPP").send({
      to,
      body: "ReviveLead test message. WhatsApp is connected.",
      leadId: "whatsapp-test",
      organizationId: user.organizationId,
    });
    if (!result.ok) return fail(result.error ?? "WhatsApp test failed.");
    return ok({ demo: result.demo, providerId: result.providerId });
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function markNotificationsReadAction() {
  try {
    const user = await withUser();
    await db.notification.updateMany({
      where: { userId: user.id, organizationId: user.organizationId, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/dashboard");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}
