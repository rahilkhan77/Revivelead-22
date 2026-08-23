import { z } from "zod";
import { db } from "@/lib/db";
import { assertMutated, ownedId } from "@/lib/tenant";

export type PropertySearchInput = {
  organizationId: string;
  location?: string | null;
  propertyType?: string | null;
  bedrooms?: number | null;
  budgetMax?: number | null;
  currency?: string | null;
  buyOrRent?: string | null;
};

export const PROPERTY_STATUSES = ["AVAILABLE", "RESERVED", "SOLD", "RENTED"] as const;

export const propertyInputSchema = z.object({
  title: z.string().trim().min(2).max(160),
  type: z.string().trim().min(1).max(80),
  location: z.string().trim().min(1).max(160),
  city: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  bedrooms: z.coerce.number().int().min(0).max(30).optional(),
  bathrooms: z.coerce.number().int().min(0).max(30).optional(),
  price: z.coerce.number().int().nonnegative().optional(),
  currency: z.string().trim().max(8).optional(),
  status: z.enum(PROPERTY_STATUSES).optional(),
  description: z.string().trim().max(4000).optional(),
  imageUrl: z.string().trim().max(500).optional(),
  externalUrl: z.string().trim().max(500).optional(),
  agentName: z.string().trim().max(120).optional(),
  leadId: z.string().trim().max(80).optional(),
});

export type PropertyInput = z.infer<typeof propertyInputSchema>;

function emptyToUndefined(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parsePropertyInput(raw: unknown) {
  return propertyInputSchema.parse(raw);
}

async function assertLeadInOrganization(organizationId: string, leadId?: string) {
  if (!leadId) return;
  const lead = await db.lead.findFirst({
    where: ownedId(organizationId, leadId),
    select: { id: true },
  });
  if (!lead) {
    throw new Error("Lead not found.");
  }
}

export async function searchProperties(input: PropertySearchInput) {
  const location = input.location?.trim();
  return db.property.findMany({
    where: {
      organizationId: input.organizationId,
      status: "AVAILABLE",
      ...(location
        ? {
            OR: [{ location: { contains: location } }, { city: { contains: location } }],
          }
        : {}),
      ...(input.propertyType ? { type: { contains: input.propertyType } } : {}),
      ...(input.bedrooms ? { bedrooms: input.bedrooms } : {}),
      ...(input.budgetMax ? { price: { lte: input.budgetMax } } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
    },
    take: 5,
    orderBy: { createdAt: "desc" },
  });
}

export async function listProperties(organizationId: string) {
  if (!organizationId) return [];
  return db.property.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getProperty(organizationId: string, id: string) {
  if (!id || !organizationId) return null;
  return db.property.findFirst({
    where: ownedId(organizationId, id),
  });
}

export async function createProperty(organizationId: string, input: PropertyInput) {
  if (!organizationId) throw new Error("Organization is required.");
  const data = propertyInputSchema.parse(input);
  await assertLeadInOrganization(organizationId, data.leadId);
  return db.property.create({
    data: {
      organizationId,
      title: data.title,
      type: data.type,
      location: data.location,
      city: emptyToUndefined(data.city),
      country: emptyToUndefined(data.country),
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      price: data.price,
      currency: data.currency || "AED",
      status: data.status ?? "AVAILABLE",
      description: emptyToUndefined(data.description),
      imageUrl: emptyToUndefined(data.imageUrl),
      externalUrl: emptyToUndefined(data.externalUrl),
      agentName: emptyToUndefined(data.agentName),
      leadId: emptyToUndefined(data.leadId),
    },
  });
}

export async function updateProperty(organizationId: string, id: string, input: Partial<PropertyInput>) {
  if (!organizationId || !id) return null;
  const existing = await getProperty(organizationId, id);
  if (!existing) return null;
  const data = propertyInputSchema.partial().parse(input);
  if (data.leadId) await assertLeadInOrganization(organizationId, data.leadId);
  const result = await db.property.updateMany({
    where: ownedId(organizationId, id),
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.location !== undefined ? { location: data.location } : {}),
      ...(data.city !== undefined ? { city: emptyToUndefined(data.city) } : {}),
      ...(data.country !== undefined ? { country: emptyToUndefined(data.country) } : {}),
      ...(data.bedrooms !== undefined ? { bedrooms: data.bedrooms } : {}),
      ...(data.bathrooms !== undefined ? { bathrooms: data.bathrooms } : {}),
      ...(data.price !== undefined ? { price: data.price } : {}),
      ...(data.currency !== undefined ? { currency: data.currency || existing.currency } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.description !== undefined ? { description: emptyToUndefined(data.description) } : {}),
      ...(data.imageUrl !== undefined ? { imageUrl: emptyToUndefined(data.imageUrl) } : {}),
      ...(data.externalUrl !== undefined ? { externalUrl: emptyToUndefined(data.externalUrl) } : {}),
      ...(data.agentName !== undefined ? { agentName: emptyToUndefined(data.agentName) } : {}),
      ...(data.leadId !== undefined ? { leadId: emptyToUndefined(data.leadId) } : {}),
    },
  });
  assertMutated(result.count, "Property not found.");
  return getProperty(organizationId, id);
}

export async function deleteProperty(organizationId: string, id: string) {
  if (!organizationId || !id) return false;
  const result = await db.property.deleteMany({
    where: ownedId(organizationId, id),
  });
  return result.count > 0;
}

export type PropertyImportRow = {
  title: string;
  location: string;
  type: string;
  price?: number;
  currency?: string;
  bedrooms?: number;
  bathrooms?: number;
  city?: string;
  country?: string;
  description?: string;
  imageUrl?: string;
  externalUrl?: string;
  agentName?: string;
};
