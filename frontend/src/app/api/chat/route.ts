import { NextResponse } from "next/server";
import { z } from "zod";
import { handleChatTurn } from "@/lib/chat/engine";
import { db } from "@/lib/db";
import { payloadTooLarge, publicWidgetCorsHeaders, tooManyRequests } from "@/lib/http";
import { clientKey, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

const schema = z.object({
  sessionId: z.string().max(80).optional(),
  widgetKey: z.string().min(8).max(80),
  message: z.string().min(1).max(1000),
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: publicWidgetCorsHeaders() });
}

export async function POST(request: Request) {
  const limited = await rateLimit(clientKey(request, "chat"), "chat");
  if (!limited.ok) {
    const response = tooManyRequests(retryAfterSeconds(limited));
    for (const [key, value] of Object.entries(publicWidgetCorsHeaders())) {
      response.headers.set(key, value);
    }
    return response;
  }
  if (payloadTooLarge(request, 20_000)) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413, headers: publicWidgetCorsHeaders() });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400, headers: publicWidgetCorsHeaders() });
  }

  const org = await db.organization.findFirst({
    where: { widgetKey: parsed.data.widgetKey },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: publicWidgetCorsHeaders() });
  }

  try {
    const result = await handleChatTurn({
      organizationId: org.id,
      sessionId: parsed.data.sessionId,
      message: parsed.data.message,
    });
    return NextResponse.json(result, { headers: publicWidgetCorsHeaders() });
  } catch {
    return NextResponse.json(
      { error: "Unable to process this chat right now." },
      { status: 500, headers: publicWidgetCorsHeaders() },
    );
  }
}
