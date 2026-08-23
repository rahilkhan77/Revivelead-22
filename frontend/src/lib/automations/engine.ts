import type { AutomationActionType, AutomationTrigger, LeadStatus } from "@prisma/client";
import { assertMemberInOrganization, resolveAssigneeInOrganization } from "@/lib/org";
import { LEAD_STATUSES } from "@/lib/constants";
import { db } from "@/lib/db";
import { parseJson } from "@/lib/format";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { dispatchWebhooks } from "@/lib/webhooks/dispatch";

type ActionConfig = {
  message?: string;
  status?: LeadStatus;
  agentId?: string;
  title?: string;
};

export async function runAutomations(
  organizationId: string,
  trigger: AutomationTrigger,
  leadId: string,
) {
  const automations = await db.automation.findMany({
    where: { organizationId, trigger, enabled: true },
  });
  const lead = await db.lead.findFirst({
    where: { id: leadId, organizationId },
  });
  if (!lead) return;

  for (const automation of automations) {
    const config = parseJson<ActionConfig>(automation.config, {});
    try {
      await executeAction(automation.action, lead.id, organizationId, config, lead.assignedAgentId);
      await db.automationExecution.create({
        data: {
          automationId: automation.id,
          leadId: lead.id,
          status: "success",
          result: JSON.stringify({ action: automation.action }),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await db.automationExecution.create({
        data: {
          automationId: automation.id,
          leadId: lead.id,
          status: "failed",
          result: message,
        },
      });
      try {
        const { notifyAutomationFailure } = await import("@/lib/email/alerts");
        await notifyAutomationFailure({
          organizationId,
          name: automation.name,
          error: message,
        });
      } catch {
        // Alert delivery must not block automations.
      }
    }
  }

  await dispatchWebhooks(organizationId, trigger, {
    leadId: lead.id,
    name: lead.name,
    status: lead.status,
    score: lead.leadScore,
  });
}

async function executeAction(
  action: AutomationActionType,
  leadId: string,
  organizationId: string,
  config: ActionConfig,
  assignedAgentId?: string | null,
) {
  const lead = await db.lead.findFirstOrThrow({
    where: { id: leadId, organizationId },
  });

  switch (action) {
    case "SEND_WHATSAPP": {
      if (lead.optedOutAt) break;
      const body = config.message ?? `Hi ${lead.name}, thanks for your enquiry. We will share matching options shortly.`;
      const result = await getMessagingProvider("WHATSAPP").send({
        to: lead.phone ?? "",
        body,
        leadId,
        organizationId,
      });
      if (!result.ok) throw new Error(result.error ?? "WhatsApp send failed.");
      await db.leadMessage.create({
        data: {
          organizationId,
          leadId,
          direction: "OUTBOUND",
          channel: "WHATSAPP",
          body,
          isAiSuggested: true,
          providerId: result.providerId,
        },
      });
      break;
    }
    case "SEND_EMAIL": {
      const body = config.message ?? `Hello ${lead.name}, following up on your property enquiry.`;
      const emailResult = await getMessagingProvider("EMAIL").send({
        to: lead.email ?? "",
        body,
        leadId,
        organizationId,
      });
      if (!emailResult.ok) throw new Error(emailResult.error ?? "Email send failed.");
      await db.leadMessage.create({
        data: {
          organizationId,
          leadId,
          direction: "OUTBOUND",
          channel: "EMAIL",
          body,
          isAiSuggested: true,
        },
      });
      break;
    }
    case "CREATE_TASK": {
      await db.followUp.create({
        data: {
          organizationId,
          leadId,
          type: "DUE_REMINDER",
          dueAt: new Date(),
          assignedToId: await resolveAssigneeInOrganization(organizationId, assignedAgentId),
          message: config.title ?? "Follow up with this lead",
        },
      });
      break;
    }
    case "NOTIFY_AGENT": {
      if (assignedAgentId) {
        await db.notification.create({
          data: {
            organizationId,
            userId: assignedAgentId,
            type: "NEW_LEAD",
            title: config.title ?? `Automation: ${lead.name}`,
            body: config.message ?? "A lead automation requires your attention.",
            link: `/leads/${leadId}`,
          },
        });
      }
      break;
    }
    case "CHANGE_LEAD_STATUS": {
      if (config.status) {
        if (!LEAD_STATUSES.includes(config.status)) {
          throw new Error("Invalid status in automation config.");
        }
        await db.lead.updateMany({
          where: { id: leadId, organizationId },
          data: { status: config.status },
        });
      }
      break;
    }
    case "ASSIGN_AGENT": {
      if (config.agentId) {
        await assertMemberInOrganization(organizationId, config.agentId);
        await db.lead.updateMany({
          where: { id: leadId, organizationId },
          data: { assignedAgentId: config.agentId },
        });
      }
      break;
    }
    default:
      break;
  }
}

export async function seedDefaultAutomations(organizationId: string) {
  const existing = await db.automation.count({ where: { organizationId } });
  if (existing > 0) return;

  await db.automation.createMany({
    data: [
      {
        organizationId,
        name: "Immediate WhatsApp on new lead",
        trigger: "LEAD_CREATED",
        action: "SEND_WHATSAPP",
        config: JSON.stringify({
          message:
            "Thank you for your enquiry. An advisor from our team will share matching options shortly.",
        }),
      },
      {
        organizationId,
        name: "Notify agent on new lead",
        trigger: "LEAD_CREATED",
        action: "NOTIFY_AGENT",
        config: JSON.stringify({ title: "New lead assigned" }),
      },
      {
        organizationId,
        name: "Alert when a lead goes hot",
        trigger: "LEAD_BECOMES_HOT",
        action: "NOTIFY_AGENT",
        config: JSON.stringify({ title: "Hot lead — call now" }),
      },
    ],
  });
}
