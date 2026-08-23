import { addHours, addMinutes } from "date-fns";
import type { FollowUpType, Lead } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { dispatchWebhooks } from "@/lib/webhooks/dispatch";
import { DEFAULT_ORG_SETTINGS, type OrgSettings } from "@/lib/constants";
import { db } from "@/lib/db";
import { parseJson } from "@/lib/format";
import { logServerError } from "@/lib/log";
import { suggestMessage } from "@/lib/ai/qualify";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { runAutomations } from "@/lib/automations/engine";
import { nextBusinessTime, isWithinBusinessHours } from "@/lib/follow-up/business-hours";
import { resolveAssigneeInOrganization } from "@/lib/org";

const BATCH_SIZE = 50;

export function getOrgSettings(raw: string | null | undefined): OrgSettings {
  const parsed = parseJson<Partial<OrgSettings>>(raw, {});
  return {
    followUp: {
      ...DEFAULT_ORG_SETTINGS.followUp,
      ...parsed.followUp,
      templates: {
        ...DEFAULT_ORG_SETTINGS.followUp.templates,
        ...parsed.followUp?.templates,
      },
    },
    notifications: { ...DEFAULT_ORG_SETTINGS.notifications, ...parsed.notifications },
    ai: { ...DEFAULT_ORG_SETTINGS.ai, ...parsed.ai },
  };
}

function applyBusinessHours(
  date: Date,
  timezone: string,
  settings: OrgSettings["followUp"],
) {
  if (!settings.respectBusinessHours) return date;
  return nextBusinessTime(date, timezone, settings.businessHoursStart, settings.businessHoursEnd);
}

function templateForStep(settings: OrgSettings["followUp"], stepIndex: number) {
  if (stepIndex === 0) return settings.templates.immediate;
  if (stepIndex === 1) return settings.templates.day1;
  if (stepIndex === 2) return settings.templates.day3;
  return settings.templates.day7;
}

export async function scheduleLeadSequence(
  lead: Lead,
  organizationSettings: string,
  timezone = "Asia/Dubai",
) {
  if (lead.status === "WON" || lead.status === "LOST") return;

  const open = await db.followUp.count({
    where: {
      leadId: lead.id,
      organizationId: lead.organizationId,
      status: { in: ["PENDING", "PROCESSING"] },
    },
  });
  if (open > 0) return;

  const settings = getOrgSettings(organizationSettings);
  const now = new Date();
  const steps: { type: FollowUpType; dueAt: Date; stepIndex: number; message: string }[] = [
    {
      type: "NEW_LEAD_RESPONSE",
      dueAt: applyBusinessHours(
        addMinutes(now, settings.followUp.immediateResponseMinutes),
        timezone,
        settings.followUp,
      ),
      stepIndex: 0,
      message: templateForStep(settings.followUp, 0),
    },
    {
      type: "NO_RESPONSE",
      dueAt: applyBusinessHours(
        addHours(now, settings.followUp.firstFollowUpHours),
        timezone,
        settings.followUp,
      ),
      stepIndex: 1,
      message: templateForStep(settings.followUp, 1),
    },
    {
      type: "NO_RESPONSE",
      dueAt: applyBusinessHours(
        addHours(now, settings.followUp.secondFollowUpHours),
        timezone,
        settings.followUp,
      ),
      stepIndex: 2,
      message: templateForStep(settings.followUp, 2),
    },
    {
      type: "AGENT_ALERT",
      dueAt: applyBusinessHours(
        addHours(now, settings.followUp.agentAlertHours),
        timezone,
        settings.followUp,
      ),
      stepIndex: 3,
      message: templateForStep(settings.followUp, 3),
    },
  ];

  const assignedToId = await resolveAssigneeInOrganization(lead.organizationId, lead.assignedAgentId);
  await db.followUp.createMany({
    data: steps.map((step) => ({
      organizationId: lead.organizationId,
      leadId: lead.id,
      type: step.type,
      dueAt: step.dueAt,
      stepIndex: step.stepIndex,
      assignedToId,
      message: step.message,
    })),
  });
  await dispatchWebhooks(lead.organizationId, "followup.created", { leadId: lead.id, steps: steps.length });

  await db.lead.updateMany({
    where: { id: lead.id, organizationId: lead.organizationId },
    data: { nextFollowUpAt: steps[0]?.dueAt },
  });
}

export async function processDueFollowUps(organizationId?: string) {
  const due = await db.followUp.findMany({
    where: {
      status: "PENDING",
      dueAt: { lte: new Date() },
      ...(organizationId ? { organizationId } : {}),
    },
    select: { id: true, organizationId: true },
    take: BATCH_SIZE,
    orderBy: { dueAt: "asc" },
  });

  let processed = 0;
  for (const item of due) {
    const claimed = await db.followUp.updateMany({
      where: { id: item.id, organizationId: item.organizationId, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (claimed.count === 0) continue;
    try {
      await executeFollowUp(item.id, item.organizationId);
      processed += 1;
    } catch {
      await db.followUp.updateMany({
        where: { id: item.id, organizationId: item.organizationId },
        data: { status: "FAILED" },
      });
      logServerError("follow_up_failed", { followUpId: item.id });
    }
  }

  return { processed, scanned: due.length };
}

export async function executeFollowUp(followUpId: string, organizationId?: string) {
  const followUp = await db.followUp.findFirst({
    where: { id: followUpId, ...(organizationId ? { organizationId } : {}) },
    include: { lead: true, organization: true },
  });
  if (!followUp || (followUp.status !== "PENDING" && followUp.status !== "PROCESSING")) return;

  const lead = followUp.lead;
  const settings = getOrgSettings(followUp.organization.settings);

  if (lead.status === "WON" || lead.status === "LOST") {
    await db.followUp.updateMany({
      where: { id: followUp.id, organizationId: followUp.organizationId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    return;
  }

  if (
    settings.followUp.respectBusinessHours &&
    !isWithinBusinessHours(
      new Date(),
      followUp.organization.timezone,
      settings.followUp.businessHoursStart,
      settings.followUp.businessHoursEnd,
    )
  ) {
    await db.followUp.updateMany({
      where: { id: followUp.id, organizationId: followUp.organizationId },
      data: {
        status: "PENDING",
        dueAt: nextBusinessTime(
          new Date(),
          followUp.organization.timezone,
          settings.followUp.businessHoursStart,
          settings.followUp.businessHoursEnd,
        ),
      },
    });
    return;
  }

  if (followUp.type === "AGENT_ALERT") {
    if (lead.assignedAgentId && settings.notifications.agentAlerts) {
      await db.notification.create({
        data: {
          organizationId: lead.organizationId,
          userId: lead.assignedAgentId,
          type: "AGENT_ALERT",
          title: `${lead.name} still has not replied`,
          body: "The follow-up sequence completed without a response. Call or reassign this lead.",
          link: `/leads/${lead.id}`,
        },
      });
    }
    await db.followUp.updateMany({
      where: { id: followUp.id, organizationId: followUp.organizationId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await runAutomations(lead.organizationId, "FOLLOW_UP_DUE", lead.id);
    return;
  }

  const alreadySent = await db.followUp.findFirst({
    where: {
      leadId: lead.id,
      organizationId: lead.organizationId,
      stepIndex: followUp.stepIndex,
      status: "SENT",
      id: { not: followUp.id },
    },
  });
  if (alreadySent) {
    await db.followUp.updateMany({
      where: { id: followUp.id, organizationId: followUp.organizationId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    return;
  }

  const body =
    followUp.message ??
    (await suggestMessage({
      leadName: lead.name,
      location: lead.location,
      propertyType: lead.propertyType,
      intent: lead.intent,
      lastMessages: [],
      goal: followUp.type === "DORMANT_REACTIVATION" ? "reactivate" : "follow_up",
    }));

  if (lead.optedOutAt) {
    await db.followUp.updateMany({
      where: { id: followUp.id, organizationId: followUp.organizationId },
      data: { status: "CANCELLED", completedAt: new Date(), message: "Lead opted out." },
    });
    return;
  }

  const to = lead.phone || lead.email || "";
  const channel = lead.phone ? "WHATSAPP" : "EMAIL";
  const result = await getMessagingProvider(channel).send({
    to,
    body,
    leadId: lead.id,
    organizationId: lead.organizationId,
  });

  if (!result.ok) {
    await db.followUp.updateMany({
      where: { id: followUp.id, organizationId: followUp.organizationId },
      data: { status: "FAILED", message: result.error ?? "Provider failed to send." },
    });
    await dispatchWebhooks(lead.organizationId, "followup.failed", {
      leadId: lead.id,
      followUpId: followUp.id,
    });
    try {
      const { notifyFollowUpFailure } = await import("@/lib/email/alerts");
      await notifyFollowUpFailure({
        organizationId: lead.organizationId,
        leadName: lead.name,
        leadId: lead.id,
        error: result.error ?? "Provider failed to send.",
      });
    } catch {
      // Alert delivery must not block the worker.
    }
    return;
  }

  await db.leadMessage.create({
    data: {
      organizationId: lead.organizationId,
      leadId: lead.id,
      direction: "OUTBOUND",
      channel,
      body,
      isAiSuggested: true,
      providerId: result.providerId,
    },
  });

  await db.followUp.updateMany({
    where: { id: followUp.id, organizationId: followUp.organizationId },
    data: { status: "SENT", completedAt: new Date(), message: body },
  });
  await dispatchWebhooks(lead.organizationId, "followup.completed", {
    leadId: lead.id,
    followUpId: followUp.id,
  });

  await db.lead.updateMany({
    where: { id: lead.id, organizationId: lead.organizationId },
    data: {
      lastContactedAt: new Date(),
      status: lead.status === "NEW" ? "CONTACTED" : lead.status,
    },
  });

  if (followUp.type === "NO_RESPONSE") {
    await runAutomations(lead.organizationId, "NO_RESPONSE", lead.id);
  }
  await runAutomations(lead.organizationId, "FOLLOW_UP_DUE", lead.id);
}

export async function cancelOpenFollowUps(leadId: string, organizationId: string) {
  await db.followUp.updateMany({
    where: {
      leadId,
      organizationId,
      status: { in: ["PENDING", "PROCESSING"] },
      type: { in: ["NO_RESPONSE", "NEW_LEAD_RESPONSE"] },
    },
    data: { status: "CANCELLED" },
  });
}

export async function markDormantLeads(organizationId: string, dormantDays = 30) {
  const cutoff = new Date(Date.now() - dormantDays * 24 * 60 * 60 * 1000);
  const inactive = await db.lead.findMany({
    where: {
      organizationId,
      status: { notIn: ["WON", "LOST", "DORMANT"] },
      OR: [
        { lastContactedAt: { lte: cutoff } },
        { lastContactedAt: null, createdAt: { lte: cutoff } },
      ],
    },
    select: { id: true },
  });
  if (inactive.length === 0) return 0;

  await db.lead.updateMany({
    where: { id: { in: inactive.map((item) => item.id) }, organizationId },
    data: { status: "DORMANT" },
  });

  for (const lead of inactive) {
    await runAutomations(organizationId, "LEAD_INACTIVE", lead.id);
  }

  await writeAudit({
    organizationId,
    action: "leads.marked_dormant",
    entity: "Lead",
    metadata: { count: inactive.length, dormantDays },
  });
  await dispatchWebhooks(organizationId, "lead.dormant", { count: inactive.length });
  return inactive.length;
}
