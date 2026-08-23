import { createHmac } from "node:crypto";
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/webhooks/inbound/route";
import { db } from "@/lib/db";
import {
  fingerprintContainsQuery,
  resolveIntegrationById,
  resolveIntegrationByPhoneNumberId,
  resolveIntegrationBySecret,
  stampSecretFingerprint,
} from "@/lib/integrations/lookup";
import { resolveOrgFromSecret } from "@/lib/org";
import { createAgency } from "./helpers";

const suffix = `p1c${Date.now()}`;

function sign(secret: string, raw: string) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function inboundUrl(path = "/api/webhooks/inbound") {
  return `http://localhost${path}`;
}

async function createStampedIntegration(input: {
  organizationId: string;
  type: "WEBHOOK" | "WHATSAPP" | "N8N";
  name: string;
  secret: string;
  phoneNumberId?: string;
  enabled?: boolean;
}) {
  return db.integration.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      name: input.name,
      enabled: input.enabled ?? true,
      config: JSON.stringify(
        stampSecretFingerprint({
          secret: input.secret,
          webhookSecret: input.secret,
          phoneNumberId: input.phoneNumberId ?? "",
        }),
      ),
    },
  });
}

function metaPayload(input: { phoneNumberId: string; from: string; body: string; id: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: input.phoneNumberId },
              contacts: [{ profile: { name: "Buyer" }, wa_id: input.from }],
              messages: [{ from: input.from, id: input.id, type: "text", text: { body: input.body } }],
            },
          },
        ],
      },
    ],
  };
}

describe("Phase 1C webhook secret lookup and inbound signatures", () => {
  let alpha: Awaited<ReturnType<typeof createAgency>>;
  let beta: Awaited<ReturnType<typeof createAgency>>;
  const alphaSecret = `alpha-secret-${suffix}`;
  const betaSecret = `beta-secret-${suffix}`;
  const whatsappSecret = `wa-secret-${suffix}`;
  let alphaWebhook: Awaited<ReturnType<typeof createStampedIntegration>>;
  let betaWebhook: Awaited<ReturnType<typeof createStampedIntegration>>;
  let alphaWhatsApp: Awaited<ReturnType<typeof createStampedIntegration>>;

  beforeAll(async () => {
    alpha = await createAgency(`alpha-${suffix}`);
    beta = await createAgency(`beta-${suffix}`);
    alphaWebhook = await createStampedIntegration({
      organizationId: alpha.organization.id,
      type: "WEBHOOK",
      name: `Alpha inbound ${suffix}`,
      secret: alphaSecret,
    });
    betaWebhook = await createStampedIntegration({
      organizationId: beta.organization.id,
      type: "WEBHOOK",
      name: `Beta inbound ${suffix}`,
      secret: betaSecret,
    });
    alphaWhatsApp = await createStampedIntegration({
      organizationId: alpha.organization.id,
      type: "WHATSAPP",
      name: `Alpha WhatsApp ${suffix}`,
      secret: whatsappSecret,
      phoneNumberId: `pnid-${suffix}`,
    });
    await db.integration.createMany({
      data: Array.from({ length: 6 }, (_, index) => ({
        organizationId: beta.organization.id,
        type: "WEBHOOK" as const,
        name: `Noise ${suffix}-${index}`,
        enabled: true,
        config: JSON.stringify({ url: "https://example.com", secret: `noise-${index}` }),
      })),
    });
  });

  afterAll(async () => {
    await alpha.cleanup();
    await beta.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves the correct integration by fingerprint without scanning unrelated rows", async () => {
    const spy = vi.spyOn(db.integration, "findMany");
    const found = await resolveIntegrationBySecret(alphaSecret, ["WEBHOOK"]);
    expect(found?.id).toBe(alphaWebhook.id);
    expect(found?.organizationId).toBe(alpha.organization.id);
    expect(spy).toHaveBeenCalled();
    for (const [arg] of spy.mock.calls) {
      expect(arg?.where?.config).toEqual({ contains: fingerprintContainsQuery(alphaSecret) });
      expect(arg?.take).toBe(2);
    }
    expect(await resolveOrgFromSecret(alphaSecret, ["WEBHOOK"])).toBe(alpha.organization.id);
  });

  it("does not let one organization resolve another organization's integration", async () => {
    await expect(resolveIntegrationById(alphaWebhook.id, ["WEBHOOK"], beta.organization.id)).resolves.toBeNull();
    await expect(resolveIntegrationBySecret(alphaSecret, ["WEBHOOK"], beta.organization.id)).resolves.toBeNull();
    await expect(resolveIntegrationByPhoneNumberId(`pnid-${suffix}`, beta.organization.id)).resolves.toBeNull();
    await expect(resolveOrgFromSecret(alphaSecret, ["WEBHOOK"], beta.organization.id)).resolves.toBeNull();
    await expect(resolveIntegrationBySecret("missing-secret", ["WEBHOOK"])).resolves.toBeNull();
    await expect(resolveIntegrationById("missing-id", ["WEBHOOK"])).resolves.toBeNull();
  });

  it("accepts a valid custom inbound signature and ignores a body organizationId", async () => {
    const raw = JSON.stringify({
      phone: `+97150${suffix.slice(-7)}1`,
      body: "Need a 2-bed in Marina",
      organizationId: beta.organization.id,
      eventId: `evt-valid-${suffix}`,
    });
    const response = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revivelead-integration": alphaWebhook.id,
          "x-revivelead-signature": sign(alphaSecret, raw),
          "x-forwarded-for": `203.0.113.${suffix.slice(-2)}`,
        },
        body: raw,
      }),
    );
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(JSON.stringify(json)).not.toContain(alphaSecret);
    expect(JSON.stringify(json)).not.toContain(betaSecret);

    const lead = await db.lead.findFirst({ where: { id: json.leadId } });
    expect(lead?.organizationId).toBe(alpha.organization.id);
    expect(lead?.organizationId).not.toBe(beta.organization.id);
  });

  it("rejects missing, invalid, modified, and wrong-secret signatures without writing", async () => {
    const raw = JSON.stringify({
      phone: `+97150${suffix.slice(-7)}2`,
      body: "Do not persist this",
      eventId: `evt-reject-${suffix}`,
    });
    const before = await db.lead.count({ where: { organizationId: alpha.organization.id } });

    const missing = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revivelead-integration": alphaWebhook.id,
          "x-forwarded-for": "203.0.113.10",
        },
        body: raw,
      }),
    );
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "Missing signature" });

    const invalid = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revivelead-integration": alphaWebhook.id,
          "x-revivelead-signature": "sha256=00",
          "x-forwarded-for": "203.0.113.11",
        },
        body: raw,
      }),
    );
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({ error: "Invalid signature" });

    const modified = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revivelead-integration": alphaWebhook.id,
          "x-revivelead-signature": sign(alphaSecret, raw),
          "x-forwarded-for": "203.0.113.12",
        },
        body: JSON.stringify({ phone: `+97150${suffix.slice(-7)}2`, body: "tampered" }),
      }),
    );
    expect(modified.status).toBe(401);

    const wrongSecret = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revivelead-integration": alphaWebhook.id,
          "x-revivelead-signature": sign(betaSecret, raw),
          "x-forwarded-for": "203.0.113.13",
        },
        body: raw,
      }),
    );
    expect(wrongSecret.status).toBe(401);

    const secretOnly = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revivelead-secret": alphaSecret,
          "x-forwarded-for": "203.0.113.14",
        },
        body: raw,
      }),
    );
    expect(secretOnly.status).toBe(401);
    const secretOnlyBody = await secretOnly.json();
    expect(secretOnlyBody.error).toBe("Unknown integration");
    expect(JSON.stringify(secretOnlyBody)).not.toContain(alphaSecret);

    const after = await db.lead.count({ where: { organizationId: alpha.organization.id } });
    expect(after).toBe(before);
  });

  it("rejects an unknown integration and does not echo secrets", async () => {
    const raw = JSON.stringify({ phone: "+971501234567", body: "Hello" });
    const response = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revivelead-integration": "missing_integration",
          "x-revivelead-signature": sign(alphaSecret, raw),
          "x-revivelead-secret": alphaSecret,
        },
        body: raw,
      }),
    );
    const json = await response.json();
    expect(response.status).toBe(401);
    expect(json.error).toBe("Unknown integration");
    expect(JSON.stringify(json)).not.toContain(alphaSecret);
  });

  it("does not duplicate side effects when the same inbound event is delivered twice", async () => {
    const raw = JSON.stringify({
      phone: `+97150${suffix.slice(-7)}3`,
      body: "Replay me once",
      eventId: `evt-dup-${suffix}`,
    });
    const headers = {
      "content-type": "application/json",
      "x-revivelead-integration": alphaWebhook.id,
      "x-revivelead-signature": sign(alphaSecret, raw),
    };
    const first = await POST(new Request(inboundUrl(), { method: "POST", headers: { ...headers, "x-forwarded-for": "203.0.113.20" }, body: raw }));
    const second = await POST(new Request(inboundUrl(), { method: "POST", headers: { ...headers, "x-forwarded-for": "203.0.113.21" }, body: raw }));
    const firstJson = await first.json();
    const secondJson = await second.json();
    expect(first.status).toBe(200);
    expect(firstJson.created).toBe(true);
    expect(secondJson.duplicate).toBe(true);
    expect(secondJson.leadId).toBe(firstJson.leadId);
    const messages = await db.leadMessage.count({
      where: { organizationId: alpha.organization.id, providerId: `evt-dup-${suffix}` },
    });
    expect(messages).toBe(1);
  });

  it("accepts a valid Meta signature and rejects a modified Meta payload", async () => {
    const payload = metaPayload({
      phoneNumberId: `pnid-${suffix}`,
      from: `97150${suffix.slice(-7)}4`,
      body: "Meta inbound",
      id: `wamid-${suffix}`,
    });
    const raw = JSON.stringify(payload);
    const accepted = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sign(whatsappSecret, raw),
          "x-forwarded-for": "203.0.113.30",
        },
        body: raw,
      }),
    );
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json();
    expect(acceptedJson.ok).toBe(true);
    expect(alphaWhatsApp.organizationId).toBe(alpha.organization.id);
    expect(JSON.stringify(acceptedJson)).not.toContain(whatsappSecret);

    const missingMetaSignature = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.32",
        },
        body: raw,
      }),
    );
    expect(missingMetaSignature.status).toBe(401);
    expect(await missingMetaSignature.json()).toEqual({ error: "Missing signature" });

    const lead = await db.lead.findFirst({ where: { id: acceptedJson.results[0].leadId } });
    expect(lead?.organizationId).toBe(alpha.organization.id);

    const tampered = JSON.stringify({
      ...payload,
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: `pnid-${suffix}` },
                messages: [{ from: `97150${suffix.slice(-7)}4`, id: `wamid-tamper-${suffix}`, type: "text", text: { body: "Hijack" } }],
              },
            },
          ],
        },
      ],
    });
    const rejected = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sign(whatsappSecret, raw),
          "x-forwarded-for": "203.0.113.31",
        },
        body: tampered,
      }),
    );
    expect(rejected.status).toBe(401);
    expect(await db.leadMessage.count({ where: { providerId: `wamid-tamper-${suffix}` } })).toBe(0);
  });

  it("verifies the Meta subscribe token without returning the secret", async () => {
    const response = await GET(
      new Request(
        inboundUrl(`/?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(whatsappSecret)}&hub.challenge=challenge-${suffix}`),
        { headers: { "x-forwarded-for": "203.0.113.40" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`challenge-${suffix}`);

    const denied = await GET(
      new Request(
        inboundUrl(`/?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(betaSecret)}&hub.challenge=nope`),
        { headers: { "x-forwarded-for": "203.0.113.41" } },
      ),
    );
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain(betaSecret);
  });

  it("cannot use organization B credentials to mutate organization A data", async () => {
    const raw = JSON.stringify({
      phone: `+97150${suffix.slice(-7)}5`,
      body: "Cross tenant attempt",
      organizationId: alpha.organization.id,
      eventId: `evt-cross-${suffix}`,
    });
    const response = await POST(
      new Request(inboundUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-revivelead-integration": betaWebhook.id,
          "x-revivelead-signature": sign(betaSecret, raw),
          "x-forwarded-for": "203.0.113.50",
        },
        body: raw,
      }),
    );
    const json = await response.json();
    expect(response.status).toBe(200);
    const lead = await db.lead.findFirst({ where: { id: json.leadId } });
    expect(lead?.organizationId).toBe(beta.organization.id);
    expect(await db.lead.count({ where: { organizationId: alpha.organization.id, phone: `+97150${suffix.slice(-7)}5` } })).toBe(0);
  });
});
