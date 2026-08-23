"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { parsePropertyInput } from "@/lib/properties/service";
import {
  createProperty,
  deleteProperty,
  getProperty,
  listProperties,
  updateProperty,
} from "@/lib/properties/service";
import { fail, ok, toErrorMessage, withUser, type ActionResult } from "@/lib/safe-action";

function propertyFields(formData: FormData) {
  return {
    title: formData.get("title"),
    type: formData.get("type") || undefined,
    location: formData.get("location"),
    city: formData.get("city") || undefined,
    country: formData.get("country") || undefined,
    bedrooms: formData.get("bedrooms") || undefined,
    bathrooms: formData.get("bathrooms") || undefined,
    price: formData.get("price") || undefined,
    currency: formData.get("currency") || undefined,
    status: formData.get("status") || undefined,
    description: formData.get("description") || undefined,
    imageUrl: formData.get("imageUrl") || undefined,
    externalUrl: formData.get("externalUrl") || undefined,
    agentName: formData.get("agentName") || undefined,
  };
}

export async function listPropertiesAction() {
  try {
    const user = await withUser();
    return ok(await listProperties(user.organizationId));
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function getPropertyAction(id: string) {
  try {
    const user = await withUser();
    const property = await getProperty(user.organizationId, id);
    if (!property) return fail("Property not found.");
    return ok(property);
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function createPropertyAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await withUser();
    const parsed = parsePropertyInput(propertyFields(formData));
    const property = await createProperty(user.organizationId, parsed);
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "property.created",
      entity: "Property",
      entityId: property.id,
    });
    revalidatePath("/properties");
    return ok({ id: property.id });
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function updatePropertyAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await withUser();
    const id = String(formData.get("id") ?? "");
    if (!id) return fail("Property not found.");
    const parsed = parsePropertyInput(propertyFields(formData));
    const property = await updateProperty(user.organizationId, id, parsed);
    if (!property) return fail("Property not found.");
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "property.updated",
      entity: "Property",
      entityId: id,
    });
    revalidatePath("/properties");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}

export async function deletePropertyAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await withUser();
    const id = String(formData.get("id") ?? "");
    const deleted = await deleteProperty(user.organizationId, id);
    if (!deleted) return fail("Property not found.");
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "property.deleted",
      entity: "Property",
      entityId: id,
    });
    revalidatePath("/properties");
    return ok();
  } catch (error) {
    return fail(toErrorMessage(error));
  }
}
