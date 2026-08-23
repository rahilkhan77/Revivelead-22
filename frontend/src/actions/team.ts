"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { assertWithinSeatLimit } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { isProduction } from "@/lib/env";
import { inviteRoleSchema } from "@/lib/roles";
import { changeMembershipRole } from "@/lib/team/roles";
import { ensureManager, fail, ok, toErrorMessage, withUser } from "@/lib/safe-action";
import { z } from "zod";

export async function inviteMemberAction(formData: FormData) {
  try {
    const user = await withUser();
    ensureManager(user.role);
    await assertWithinSeatLimit(user.organizationId);

    const email = String(formData.get("email") ?? "").toLowerCase().trim();
    const parsedRole = inviteRoleSchema.safeParse(String(formData.get("role") ?? "SALES_AGENT"));
    if (!email || !z.string().email().safeParse(email).success) return fail("A valid email is required.");
    if (!parsedRole.success) return fail("Invalid role.");
    const role = parsedRole.data;
    if (role === "ADMIN" && user.role !== "OWNER") return fail("Only the owner can invite admins.");

    const token = randomBytes(24).toString("hex");
    await db.invitation.create({
      data: {
        organizationId: user.organizationId,
        email,
        role,
        token,
        invitedById: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const inviteUrl = `${process.env.AUTH_URL ?? "http://localhost:3000"}/invite/${token}`;
    const { getEmailProvider } = await import("@/lib/email/resend");
    const emailed = await getEmailProvider().send({
      to: email,
      subject: "You are invited to ReviveLead",
      html: `<p>You have been invited to join an agency on ReviveLead.</p><p><a href="${inviteUrl}">Accept invitation</a></p>`,
      text: `Accept your ReviveLead invitation: ${inviteUrl}`,
    });
    if (emailed.demo && process.env.NODE_ENV !== "production") {
      console.info("[invite]", inviteUrl);
    }
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "team.invited",
      entity: "Invitation",
      metadata: { email, role },
    });
    revalidatePath("/team");
    revalidatePath("/settings");
    return ok({ inviteUrl: emailed.ok && !emailed.demo && isProduction() ? undefined : inviteUrl });
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function updateMemberRoleAction(formData: FormData) {
  try {
    const user = await withUser();
    const membershipId = String(formData.get("membershipId") ?? "");
    await changeMembershipRole({
      organizationId: user.organizationId,
      actorRole: user.role,
      membershipId,
      role: String(formData.get("role") ?? ""),
    });
    revalidatePath("/team");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}
