import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { updateLeadStatus } from "@/lib/leads/service";
import { EmailProvider } from "@/lib/messaging/email";
import {
  createProperty,
  deleteProperty,
  getProperty,
  listProperties,
  updateProperty,
} from "@/lib/properties/service";
import { createAgency } from "./helpers";

const suffix = `p1b${Date.now()}`;

describe("Phase 1B property CRUD and tenant isolation", () => {
  let alpha: Awaited<ReturnType<typeof createAgency>>;
  let beta: Awaited<ReturnType<typeof createAgency>>;

  beforeAll(async () => {
    alpha = await createAgency(`alpha-${suffix}`);
    beta = await createAgency(`beta-${suffix}`);
  });

  afterAll(async () => {
    await alpha.cleanup();
    await beta.cleanup();
  });

  it("creates, lists, gets, updates, and deletes a property inside one organization", async () => {
    const created = await createProperty(alpha.organization.id, {
      title: "Marina View",
      type: "Apartment",
      location: "Dubai Marina",
      bedrooms: 2,
      price: 1800000,
      currency: "AED",
    });
    expect(created.organizationId).toBe(alpha.organization.id);

    const listed = await listProperties(alpha.organization.id);
    expect(listed.some((item) => item.id === created.id)).toBe(true);

    const fetched = await getProperty(alpha.organization.id, created.id);
    expect(fetched?.title).toBe("Marina View");

    const updated = await updateProperty(alpha.organization.id, created.id, {
      title: "Marina View Updated",
      type: "Apartment",
      location: "Dubai Marina",
      status: "RESERVED",
    });
    expect(updated?.title).toBe("Marina View Updated");
    expect(updated?.status).toBe("RESERVED");

    await expect(deleteProperty(alpha.organization.id, created.id)).resolves.toBe(true);
    await expect(getProperty(alpha.organization.id, created.id)).resolves.toBeNull();
  });

  it("rejects unauthorized property access without an organization", async () => {
    await expect(getProperty("", "missing")).resolves.toBeNull();
    await expect(listProperties("")).resolves.toEqual([]);
    await expect(updateProperty("", "missing", { title: "Nope" })).resolves.toBeNull();
    await expect(deleteProperty("", "missing")).resolves.toBe(false);
    await expect(
      createProperty("", {
        title: "Unauthed",
        type: "Apartment",
        location: "Dubai",
      }),
    ).rejects.toThrow(/organization/i);
  });

  it("blocks cross-organization property update and delete", async () => {
    const property = await createProperty(alpha.organization.id, {
      title: "Alpha Only",
      type: "Villa",
      location: "Palm Jumeirah",
    });

    await expect(getProperty(beta.organization.id, property.id)).resolves.toBeNull();
    await expect(updateProperty(beta.organization.id, property.id, { title: "Hijacked" })).resolves.toBeNull();
    await expect(deleteProperty(beta.organization.id, property.id)).resolves.toBe(false);

    const stillAlpha = await getProperty(alpha.organization.id, property.id);
    expect(stillAlpha?.title).toBe("Alpha Only");
  });

  it("prevents organization A from updating or deleting organization B leads", async () => {
    const lead = await db.lead.create({
      data: {
        organizationId: beta.organization.id,
        name: "Beta Exclusive",
        phone: "+971509999001",
      },
    });

    await expect(
      updateLeadStatus({
        organizationId: alpha.organization.id,
        leadId: lead.id,
        status: "CONTACTED",
        actorId: alpha.owner.id,
      }),
    ).rejects.toThrow(/not found/i);

    const updated = await db.lead.updateMany({
      where: { id: lead.id, organizationId: alpha.organization.id },
      data: { name: "Stolen" },
    });
    expect(updated.count).toBe(0);

    const deleted = await db.lead.deleteMany({
      where: { id: lead.id, organizationId: alpha.organization.id },
    });
    expect(deleted.count).toBe(0);

    const intact = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(intact.name).toBe("Beta Exclusive");
    expect(intact.organizationId).toBe(beta.organization.id);
  });
});

describe("Phase 1B email fail-closed", () => {
  it("returns success only when the provider confirms the send", async () => {
    const provider = new EmailProvider({
      loadConfig: async () => ({ enabled: true, smtpHost: "smtp.example.com", fromEmail: "agency@example.com" }),
      transport: async () => ({ ok: true, id: "msg_123" }),
    });
    const result = await provider.send({
      to: "buyer@example.com",
      body: "Two matching apartments are available.",
      leadId: "lead_1",
      organizationId: "org_1",
    });
    expect(result).toMatchObject({ ok: true, provider: "email", providerId: "msg_123" });
  });

  it("returns explicit failure when the provider rejects the send", async () => {
    const provider = new EmailProvider({
      loadConfig: async () => ({ enabled: true, smtpHost: "smtp.example.com", fromEmail: "agency@example.com" }),
      transport: async () => ({ ok: false, error: "550 mailbox unavailable" }),
    });
    const result = await provider.send({
      to: "buyer@example.com",
      body: "Checking in",
      leadId: "lead_1",
      organizationId: "org_1",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("550 mailbox unavailable");
  });

  it("fails closed when email is not configured", async () => {
    const provider = new EmailProvider({
      loadConfig: async () => null,
      transport: async () => ({ ok: true, id: "should-not-send" }),
    });
    const result = await provider.send({
      to: "buyer@example.com",
      body: "Hello",
      leadId: "lead_1",
      organizationId: "org_1",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  it("rejects malformed recipients and empty messages", async () => {
    const provider = new EmailProvider({
      loadConfig: async () => ({ enabled: true, smtpHost: "smtp.example.com", fromEmail: "agency@example.com" }),
      transport: async () => ({ ok: true, id: "should-not-send" }),
    });
    const badRecipient = await provider.send({
      to: "not-an-email",
      body: "Hello",
      leadId: "lead_1",
      organizationId: "org_1",
    });
    expect(badRecipient.ok).toBe(false);
    expect(badRecipient.error).toMatch(/valid email/i);

    const empty = await provider.send({
      to: "buyer@example.com",
      body: "   ",
      leadId: "lead_1",
      organizationId: "org_1",
    });
    expect(empty.ok).toBe(false);
    expect(empty.error).toMatch(/cannot be empty/i);
  });

  it("does not treat a transport success without a provider id as sent", async () => {
    const provider = new EmailProvider({
      loadConfig: async () => ({ enabled: true, smtpHost: "smtp.example.com", fromEmail: "agency@example.com" }),
      transport: async () => ({ ok: true }),
    });
    const result = await provider.send({
      to: "buyer@example.com",
      body: "Hello",
      leadId: "lead_1",
      organizationId: "org_1",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/did not confirm/i);
  });
});
