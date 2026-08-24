"use server";

import { revalidatePath } from "next/cache";
import { canViewAllLeads } from "@/lib/roles";
import { db } from "@/lib/db";
import {
  canActOnFollowUp,
  cancelFollowUpForUser,
  completeFollowUpForUser,
  rescheduleFollowUpForUser,
} from "@/lib/follow-up/access";
import { executeFollowUp, markDormantLeads, processDueFollowUps } from "@/lib/follow-up/engine";
import { leadVisibilityWhere } from "@/lib/leads/service";
import { resolveAssigneeInOrganization } from "@/lib/org";
import { ensureManager, fail, ok, toErrorMessage, withUser } from "@/lib/safe-action";
import { ownedId } from "@/lib/tenant";

export async function completeFollowUpAction(formData: FormData) {
  try {
    const user = await withUser();
    const id = String(formData.get("id") ?? "");
    await completeFollowUpForUser({
      organizationId: user.organizationId,
      user,
      followUpId: id,
    });
    revalidatePath("/follow-ups");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function rescheduleFollowUpAction(formData: FormData) {
  try {
    const user = await withUser();
    const id = String(formData.get("id") ?? "");
    const dueRaw = String(formData.get("dueAt") ?? "");
    if (!dueRaw) return fail("Pick a new date and time.");
    const dueAt = new Date(dueRaw);
    if (Number.isNaN(dueAt.getTime())) return fail("Invalid due date.");
    await rescheduleFollowUpForUser({
      organizationId: user.organizationId,
      user,
      followUpId: id,
      dueAt,
    });
    revalidatePath("/follow-ups");
    revalidatePath("/leads");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function cancelFollowUpAction(formData: FormData) {
  try {
    const user = await withUser();
    const id = String(formData.get("id") ?? "");
    await cancelFollowUpForUser({
      organizationId: user.organizationId,
      user,
      followUpId: id,
    });
    revalidatePath("/follow-ups");
    revalidatePath("/leads");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function runFollowUpEngineAction() {
  try {
    const user = await withUser();
    ensureManager(user.role);
    const result = await processDueFollowUps(user.organizationId);
    const org = await db.organization.findUnique({ where: { id: user.organizationId } });
    const settings = org ? JSON.parse(org.settings || "{}") : {};
    await markDormantLeads(user.organizationId, settings.followUp?.dormantDays ?? 30);
    revalidatePath("/follow-ups");
    revalidatePath("/dashboard");
    revalidatePath("/leads");
    return ok(result);
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function sendFollowUpNowAction(formData: FormData) {
  try {
    const user = await withUser();
    const id = String(formData.get("id") ?? "");
    const followUp = await db.followUp.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!followUp) return fail("Follow-up not found.");
    if (!canActOnFollowUp(user, followUp)) {
      return fail("You can only send follow-ups assigned to you.");
    }
    if (followUp.status === "FAILED") {
      const reset = await db.followUp.updateMany({
        where: ownedId(user.organizationId, id),
        data: { status: "PENDING" },
      });
      if (reset.count === 0) return fail("Follow-up not found.");
    }
    await executeFollowUp(id, user.organizationId);
    revalidatePath("/follow-ups");
    revalidatePath("/leads");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function createManualFollowUpAction(formData: FormData) {
  try {
    const user = await withUser();
    const leadId = String(formData.get("leadId") ?? "");
    const message = String(formData.get("message") ?? "").slice(0, 4000);
    const dueRaw = String(formData.get("dueAt") ?? "");
    const dueAt = dueRaw ? new Date(dueRaw) : new Date();
    if (Number.isNaN(dueAt.getTime())) return fail("Invalid due date.");
    const lead = await db.lead.findFirst({
      where: { id: leadId, ...leadVisibilityWhere(user.organizationId, user.id, canViewAllLeads(user.role)) },
    });
    if (!lead) return fail("Lead not found.");
    await db.followUp.create({
      data: {
        organizationId: user.organizationId,
        leadId,
        type: "DUE_REMINDER",
        dueAt,
        assignedToId: await resolveAssigneeInOrganization(user.organizationId, lead.assignedAgentId),
        message: message || "Manual follow-up",
      },
    });
    const touched = await db.lead.updateMany({
      where: ownedId(user.organizationId, leadId),
      data: { nextFollowUpAt: dueAt },
    });
    if (touched.count === 0) return fail("Lead not found.");
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/follow-ups");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}
