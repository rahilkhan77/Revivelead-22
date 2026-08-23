"use server";

import { revalidatePath } from "next/cache";
import type { AutomationActionType, AutomationTrigger } from "@prisma/client";
import { assertWithinAutomationLimit } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { ensureManager, fail, ok, toErrorMessage, withUser } from "@/lib/safe-action";

export async function upsertAutomationAction(formData: FormData) {
  try {
    const user = await withUser();
    ensureManager(user.role);
    const id = String(formData.get("id") ?? "");
    const data = {
      name: String(formData.get("name") ?? "Untitled automation"),
      trigger: String(formData.get("trigger") ?? "LEAD_CREATED") as AutomationTrigger,
      action: String(formData.get("action") ?? "NOTIFY_AGENT") as AutomationActionType,
      enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
      config: JSON.stringify({
        message: String(formData.get("message") ?? ""),
        status: String(formData.get("status") ?? "") || undefined,
        agentId: String(formData.get("agentId") ?? "") || undefined,
      }),
    };

    if (id) {
      const existing = await db.automation.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!existing) return fail("Automation not found.");
      const updated = await db.automation.updateMany({
        where: { id, organizationId: user.organizationId },
        data,
      });
      if (updated.count === 0) return fail("Automation not found.");
    } else {
      await assertWithinAutomationLimit(user.organizationId);
      await db.automation.create({
        data: { ...data, organizationId: user.organizationId },
      });
    }
    revalidatePath("/automations");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function toggleAutomationAction(formData: FormData) {
  try {
    const user = await withUser();
    ensureManager(user.role);
    const id = String(formData.get("id") ?? "");
    const automation = await db.automation.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!automation) return fail("Automation not found.");
    const toggled = await db.automation.updateMany({
      where: { id, organizationId: user.organizationId },
      data: { enabled: !automation.enabled },
    });
    if (toggled.count === 0) return fail("Automation not found.");
    revalidatePath("/automations");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function deleteAutomationAction(formData: FormData) {
  try {
    const user = await withUser();
    ensureManager(user.role);
    const id = String(formData.get("id") ?? "");
    await db.automation.deleteMany({
      where: { id, organizationId: user.organizationId },
    });
    revalidatePath("/automations");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}
