"use server";

import { revalidatePath } from "next/cache";
import { suggestMessage } from "@/lib/ai/qualify";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { ensureManager, fail, ok, toErrorMessage, withUser } from "@/lib/safe-action";
import { dispatchWebhooks } from "@/lib/webhooks/dispatch";

export async function createReactivationCampaignAction(formData: FormData) {
  try {
    const user = await withUser({ policy: "ai" });
    ensureManager(user.role);
    const days = Number(formData.get("days") ?? 30);
    if (!Number.isFinite(days) || days < 1 || days > 365) return fail("Invalid filter range.");
    const segment = String(formData.get("segment") ?? "dormant_30").slice(0, 80);
    const name = String(formData.get("name") ?? `Reactivation ${new Date().toLocaleDateString()}`).slice(0, 120);
    const { segmentWhere } = await import("@/lib/reactivation/segments");

    const open = await db.campaign.findFirst({
      where: {
        organizationId: user.organizationId,
        segment,
        status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENDING"] },
      },
    });
    if (open) return fail("A campaign for this segment is already awaiting approval or sending.");

    const leads = await db.lead.findMany({
      where: segmentWhere(user.organizationId, segment, days),
      take: 50,
    });

    if (leads.length === 0) return fail("No dormant leads match that filter.");

    const campaign = await db.campaign.create({
      data: {
        organizationId: user.organizationId,
        name,
        status: "PENDING_APPROVAL",
        filterDays: days,
        segment,
        createdById: user.id,
      },
    });

    for (const lead of leads) {
      const message = await suggestMessage({
        leadName: lead.name,
        location: lead.location,
        propertyType: lead.propertyType,
        intent: lead.intent,
        lastMessages: [],
        goal: "reactivate",
      });
      await db.campaignRecipient.create({
        data: {
          campaignId: campaign.id,
          leadId: lead.id,
          message,
        },
      });
    }

    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "campaign.created",
      entity: "Campaign",
      entityId: campaign.id,
      metadata: { recipients: leads.length, days },
    });
    revalidatePath("/reactivation");
    return ok({ id: campaign.id });
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function updateCampaignMessageAction(formData: FormData) {
  try {
    const user = await withUser();
    ensureManager(user.role);
    const id = String(formData.get("id") ?? "");
    const message = String(formData.get("message") ?? "");
    const recipient = await db.campaignRecipient.findFirst({
      where: { id, campaign: { organizationId: user.organizationId } },
    });
    if (!recipient) return fail("Recipient not found.");
    const updated = await db.campaignRecipient.updateMany({
      where: { id, campaign: { organizationId: user.organizationId } },
      data: { message },
    });
    if (updated.count === 0) return fail("Recipient not found.");
    revalidatePath("/reactivation");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function sendCampaignAction(formData: FormData) {
  try {
    const user = await withUser();
    ensureManager(user.role);
    const campaignId = String(formData.get("campaignId") ?? "");
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, organizationId: user.organizationId },
      include: { recipients: { include: { lead: true } } },
    });
    if (!campaign) return fail("Campaign not found.");
    if (String(formData.get("confirm") ?? "") !== "yes") {
      return fail("Owner confirmation is required before sending a campaign.");
    }
    if (campaign.status === "SENT") {
      return fail("This campaign has already been sent.");
    }
    if (campaign.status === "PAUSED") {
      return fail("Resume the campaign before sending.");
    }

    const sending = await db.campaign.updateMany({
      where: { id: campaignId, organizationId: user.organizationId },
      data: { status: "SENDING" },
    });
    if (sending.count === 0) return fail("Campaign not found.");

    let sent = 0;
    let failed = 0;
    for (const recipient of campaign.recipients) {
      const latest = await db.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
      if (latest?.status === "PAUSED") break;
      if (recipient.status === "SENT" || recipient.status === "RESPONDED") continue;
      if (recipient.lead.optedOutAt) {
        await db.campaignRecipient.updateMany({
          where: { id: recipient.id, campaign: { organizationId: user.organizationId } },
          data: { status: "FAILED" },
        });
        failed += 1;
        continue;
      }

      const channel = recipient.lead.phone ? "WHATSAPP" : "EMAIL";
      const result = await getMessagingProvider(channel).send({
        to: recipient.lead.phone || recipient.lead.email || "",
        body: recipient.message,
        leadId: recipient.leadId,
        organizationId: user.organizationId,
      });

      if (!result.ok) {
        await db.campaignRecipient.updateMany({
          where: { id: recipient.id, campaign: { organizationId: user.organizationId } },
          data: { status: "FAILED" },
        });
        failed += 1;
        continue;
      }

      await db.leadMessage.create({
        data: {
          organizationId: user.organizationId,
          leadId: recipient.leadId,
          direction: "OUTBOUND",
          channel,
          body: recipient.message,
          isAiSuggested: true,
          providerId: result.providerId,
        },
      });

      await db.campaignRecipient.updateMany({
        where: { id: recipient.id, campaign: { organizationId: user.organizationId } },
        data: { status: "SENT", sentAt: new Date() },
      });

      await db.lead.updateMany({
        where: { id: recipient.leadId, organizationId: user.organizationId },
        data: {
          isReactivated: true,
          reactivatedAt: new Date(),
          lastContactedAt: new Date(),
          status: recipient.lead.status === "DORMANT" ? "CONTACTED" : recipient.lead.status,
        },
      });
      sent += 1;
      await dispatchWebhooks(user.organizationId, "lead.reactivated", { leadId: recipient.leadId });
    }

    const remaining = await db.campaignRecipient.count({
      where: { campaignId, status: { in: ["PENDING", "APPROVED", "FAILED"] } },
    });
    await db.campaign.updateMany({
      where: { id: campaignId, organizationId: user.organizationId },
      data:
        remaining === 0
          ? { status: "SENT", sentAt: new Date() }
          : { status: failed && !sent ? "PENDING_APPROVAL" : "SENT", sentAt: new Date() },
    });

    await db.revenueEvent.create({
      data: {
        organizationId: user.organizationId,
        type: "campaign_contacted",
        amount: 0,
        note: `${campaign.recipients.length} dormant leads contacted in ${campaign.name}`,
      },
    });

    revalidatePath("/reactivation");
    revalidatePath("/revenue");
    return ok({ sent, failed });
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function pauseCampaignAction(formData: FormData) {
  try {
    const user = await withUser();
    ensureManager(user.role);
    const campaignId = String(formData.get("campaignId") ?? "");
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, organizationId: user.organizationId },
    });
    if (!campaign) return fail("Campaign not found.");
    if (campaign.status !== "SENDING" && campaign.status !== "PENDING_APPROVAL" && campaign.status !== "APPROVED") {
      return fail("Only an open campaign can be paused.");
    }
    const paused = await db.campaign.updateMany({
      where: { id: campaignId, organizationId: user.organizationId },
      data: { status: "PAUSED" },
    });
    if (paused.count === 0) return fail("Campaign not found.");
    revalidatePath("/reactivation");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function resumeCampaignAction(formData: FormData) {
  try {
    const user = await withUser();
    ensureManager(user.role);
    const campaignId = String(formData.get("campaignId") ?? "");
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, organizationId: user.organizationId },
    });
    if (!campaign) return fail("Campaign not found.");
    if (campaign.status !== "PAUSED") return fail("Only a paused campaign can be resumed.");
    const resumed = await db.campaign.updateMany({
      where: { id: campaignId, organizationId: user.organizationId },
      data: { status: "PENDING_APPROVAL" },
    });
    if (resumed.count === 0) return fail("Campaign not found.");
    revalidatePath("/reactivation");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function retryFailedCampaignAction(formData: FormData) {
  try {
    const user = await withUser();
    ensureManager(user.role);
    const campaignId = String(formData.get("campaignId") ?? "");
    if (String(formData.get("confirm") ?? "") !== "yes") {
      return fail("Owner confirmation is required before retrying failed messages.");
    }
    const failed = await db.campaignRecipient.findMany({
      where: { campaignId, status: "FAILED", campaign: { organizationId: user.organizationId } },
    });
    if (failed.length === 0) return fail("No failed recipients to retry.");
    await db.campaignRecipient.updateMany({
      where: {
        id: { in: failed.map((item) => item.id) },
        campaign: { organizationId: user.organizationId },
      },
      data: { status: "PENDING" },
    });
    await db.campaign.updateMany({
      where: { id: campaignId, organizationId: user.organizationId },
      data: { status: "PENDING_APPROVAL" },
    });
    revalidatePath("/reactivation");
    return ok({ count: failed.length });
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}
