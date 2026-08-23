import { getLlmProvider } from "@/lib/ai/provider";
import { HeuristicProvider } from "@/lib/ai/heuristic";
import { ingestLead } from "@/lib/leads/service";
import { db } from "@/lib/db";
import { searchProperties } from "@/lib/properties/service";
import { chatExtractSchema, hasEnoughLeadInfo, mergeExtract, type ChatExtract } from "@/lib/chat/schema";
import { parseJson } from "@/lib/format";
import { randomToken } from "@/lib/crypto/hash";

const SYSTEM = `You are a professional real-estate qualification assistant for a revenue recovery platform.
Ask one or two questions at a time. Collect name, phone or email, buy/rent, property type, location, budget, bedrooms and timeline naturally.
Never invent listings, prices or availability.
Return JSON only:
{ "name", "phone", "email", "buyOrRent": "BUYING|RENTING|UNKNOWN", "propertyType", "location", "budget", "currency", "bedrooms", "timeline", "wantsHuman": boolean, "reply": "message to visitor" }
If the visitor asks for a human, set wantsHuman true.`;

export async function startOrGetSession(organizationId: string, sessionId?: string) {
  if (sessionId) {
    const existing = await db.chatSession.findFirst({
      where: { publicId: sessionId, organizationId },
    });
    if (existing) return existing;
  }
  return db.chatSession.create({
    data: {
      organizationId,
      publicId: `cs_${randomToken(12)}`,
    },
  });
}

export async function handleChatTurn(input: {
  organizationId: string;
  sessionId?: string;
  message: string;
}) {
  const session = await startOrGetSession(input.organizationId, input.sessionId);
  const text = input.message.trim().slice(0, 1000);
  if (!text) throw new Error("Message cannot be empty.");

  await db.chatMessage.create({
    data: { sessionId: session.id, role: "visitor", body: text },
  });

  const history = await db.chatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const current = parseJson<ChatExtract>(session.extractedJson, { reply: "", wantsHuman: false });
  const extracted = await extractFromConversation(current, history.map((item) => `${item.role}: ${item.body}`).join("\n"));
  const merged = mergeExtract(current, extracted);

  const properties = await searchProperties({
    organizationId: input.organizationId,
    location: merged.location,
    propertyType: merged.propertyType,
    bedrooms: merged.bedrooms,
    budgetMax: merged.budget,
    currency: merged.currency,
  });

  let leadId = session.leadId;
  if (!leadId && hasEnoughLeadInfo(merged)) {
    const lead = await ingestLead({
      organizationId: input.organizationId,
      name: merged.name ?? "Website visitor",
      phone: merged.phone ?? undefined,
      email: merged.email || undefined,
      source: "Website chatbot",
      propertyType: merged.propertyType ?? undefined,
      location: merged.location ?? undefined,
      budgetMax: merged.budget ?? undefined,
      currency: merged.currency ?? undefined,
      bedrooms: merged.bedrooms ?? undefined,
      intent: merged.buyOrRent ?? "UNKNOWN",
      timeline: merged.timeline ?? undefined,
      notes: history.map((item) => item.body).join("\n").slice(0, 2000),
    });
    leadId = lead.id;
  }

  if (merged.wantsHuman || (leadId && (merged.budget ?? 0) >= 1_000_000)) {
    await handoffToAgent(input.organizationId, leadId, merged);
    await db.chatSession.updateMany({
      where: { id: session.id, organizationId: input.organizationId },
      data: { status: "HANDOFF", leadId, extractedJson: JSON.stringify(merged) },
    });
  } else {
    await db.chatSession.updateMany({
      where: { id: session.id, organizationId: input.organizationId },
      data: { leadId, extractedJson: JSON.stringify(merged) },
    });
  }

  await db.chatMessage.create({
    data: { sessionId: session.id, role: "assistant", body: extracted.reply },
  });

  return {
    sessionId: session.publicId,
    reply: extracted.reply,
    properties: properties.map((item) => ({
      title: item.title,
      location: item.location,
      price: item.price,
      currency: item.currency,
      bedrooms: item.bedrooms,
      imageUrl: item.imageUrl,
      externalUrl: item.externalUrl,
    })),
    handoff: merged.wantsHuman,
    leadCaptured: Boolean(leadId),
  };
}

async function extractFromConversation(current: ChatExtract, conversation: string): Promise<ChatExtract> {
  const provider = getLlmProvider();
  try {
    const raw = await provider.generateJson<unknown>(
      SYSTEM,
      JSON.stringify({ known: current, conversation }),
    );
    return chatExtractSchema.parse(raw);
  } catch {
    const fallback = await new HeuristicProvider().generateText(
      "suggestion",
      JSON.stringify({ leadName: current.name, location: current.location, propertyType: current.propertyType }),
    );
    const parsed = chatExtractSchema.safeParse({
      ...current,
      reply: fallback,
    });
    return parsed.success
      ? parsed.data
      : { ...current, reply: "Thanks — I can help you find matching homes. What area and budget should I start with?" };
  }
}

async function handoffToAgent(organizationId: string, leadId: string | null, extract: ChatExtract) {
  if (!leadId) return;
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId } });
  if (!lead?.assignedAgentId) return;
  await db.notification.create({
    data: {
      organizationId,
      userId: lead.assignedAgentId,
      type: "NEW_LEAD",
      title: `HOT LEAD · ${extract.name ?? lead.name}`,
      body: `${extract.location ?? lead.location ?? "Location TBC"} · ${extract.propertyType ?? lead.propertyType ?? "Property"} · budget ${extract.budget ?? lead.budgetMax ?? "TBC"}. Recommended: send matching properties and schedule a viewing.`,
      link: `/leads/${lead.id}`,
    },
  });
}
