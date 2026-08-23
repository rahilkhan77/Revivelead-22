import { z } from "zod";
import type { IntentType } from "@prisma/client";
import { db } from "@/lib/db";
import { assertMemberInOrganization } from "@/lib/org";
import { normalizeEmail, normalizePhone } from "@/lib/leads/normalize";
import { ownedId } from "@/lib/tenant";

export const leadFieldSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(160).optional().or(z.literal("")),
  source: z.string().max(80).optional(),
  propertyType: z.string().max(80).optional(),
  location: z.string().max(120).optional(),
  budgetMin: z.coerce.number().int().nonnegative().optional(),
  budgetMax: z.coerce.number().int().nonnegative().optional(),
  intent: z.enum(["BUYING", "RENTING", "UNKNOWN"]).optional(),
  timeline: z.string().max(80).optional(),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  notes: z.string().max(4000).optional(),
  assignedAgentId: z.string().max(80).optional(),
});

export type LeadFieldInput = z.infer<typeof leadFieldSchema>;

export async function updateLeadFields(input: {
  organizationId: string;
  leadId: string;
  visibilityWhere: Record<string, unknown>;
  fields: unknown;
}) {
  if (!input.organizationId || !input.leadId) {
    throw new Error("Lead not found.");
  }
  const existing = await db.lead.findFirst({
    where: { id: input.leadId, ...input.visibilityWhere },
  });
  if (!existing) throw new Error("Lead not found.");

  const parsed = leadFieldSchema.partial().parse(input.fields);
  if (parsed.assignedAgentId) {
    await assertMemberInOrganization(input.organizationId, parsed.assignedAgentId);
  }

  const updated = await db.lead.updateMany({
    where: ownedId(input.organizationId, input.leadId),
    data: {
      ...parsed,
      intent: parsed.intent as IntentType | undefined,
      phoneNormalized: parsed.phone ? normalizePhone(parsed.phone) : undefined,
      emailNormalized: parsed.email ? normalizeEmail(parsed.email) : undefined,
    },
  });
  if (updated.count === 0) throw new Error("Lead not found.");
  return db.lead.findFirst({
    where: ownedId(input.organizationId, input.leadId),
  });
}
