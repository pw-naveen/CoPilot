import { NextResponse, type NextRequest } from "next/server";
import { getSetting } from "@/server/config";
import { safeEqual } from "@/server/crypto";
import { enqueueWebhook } from "@/server/whatsapp/inbound";

/**
 * Evolution API webhook (MESSAGES_UPSERT, CONNECTION_UPDATE, QRCODE_UPDATED).
 * Every call must carry the shared secret (query `secret` or header `x-webhook-secret`).
 * The payload is handed to the worker; nothing slow happens here.
 */
export async function POST(req: NextRequest) {
  const expected = await getSetting("evolution.webhook_secret");
  const given = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
  if (!expected || !safeEqual(given, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }
  await enqueueWebhook("evolution", payload);
  return NextResponse.json({ ok: true });
}
