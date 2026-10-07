import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { devToolsEnabled } from "@/server/clock";
import { storage } from "@/server/storage";
import { enqueueWebhook } from "@/server/whatsapp/inbound";

/** Dev-only mock phone: read a number's thread, or send a message as that number. */
export async function GET(req: NextRequest) {
  if (!devToolsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const phone = req.nextUrl.searchParams.get("phone") ?? "";
  const rows = await db.query.waMessages.findMany({ where: eq(schema.waMessages.phoneE164, phone), orderBy: desc(schema.waMessages.createdAt), limit: 100 });
  const messages = await Promise.all(
    rows.reverse().map(async (m) => ({ id: m.id, direction: m.direction, status: m.status, type: m.type, body: m.body, transcript: m.transcript, createdAt: m.createdAt, sendAfter: m.sendAfter, mediaUrl: m.mediaUrl ? await storage().signedUrl(m.mediaUrl) : (m.rawJson as { mediaUrl?: string } | null)?.mediaUrl ?? null })),
  );
  return NextResponse.json({ messages });
}

const input = z.object({
  from: z.string(),
  text: z.string().optional(),
  caption: z.string().optional(),
  media: z.object({ base64: z.string(), mime: z.string() }).optional(),
});

export async function POST(req: NextRequest) {
  if (!devToolsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const p = input.parse(await req.json());
  await enqueueWebhook("mock", p);
  return NextResponse.json({ ok: true });
}
