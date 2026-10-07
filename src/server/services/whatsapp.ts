import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AnyActor } from "../actor";
import { audit } from "../audit";
import { randomDigits } from "../crypto";
import { conflict, notFound } from "../errors";
import { assertUserAccess, requireAdmin } from "../scope";
import { storage } from "../storage";
import { queueMessage } from "../whatsapp/outbox";
import { e164 } from "./accounts";

/** Step 7: confirm the number (optionally correcting it) and send the verification message. */
export async function startVerification(actor: AnyActor, userId: string, phone?: string) {
  await assertUserAccess(actor, userId);
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) throw notFound();
  if (u.whatsappVerifiedAt) throw conflict("WhatsApp is already verified");
  if (u.onboardingStep < 7) throw conflict("Finish the earlier steps first");
  let number = u.phoneE164;
  if (phone && phone !== u.phoneE164) {
    number = e164.parse(phone);
    const clash = await db.query.users.findFirst({ where: and(eq(schema.users.phoneE164, number), ne(schema.users.id, userId)) });
    if (clash) throw conflict("That number is already used by another account");
  }
  const code = randomDigits(4);
  await db.update(schema.users).set({ phoneE164: number, whatsappVerifyCode: code }).where(eq(schema.users.id, userId));
  await audit(actor, { action: "whatsapp.verify_sent", entity: "user", entityId: userId, userId, after: { phone: number } });
  await queueMessage({
    userId,
    phone: number,
    kind: "verify",
    text: `Hi ${u.displayName}, this is your Persona assistant. Reply YES ${code} to confirm this is your WhatsApp number.`,
  });
  return { phone: number };
}

export async function thread(actor: AnyActor, userId: string, limit = 200) {
  await assertUserAccess(actor, userId);
  const rows = await db.query.waMessages.findMany({ where: eq(schema.waMessages.userId, userId), orderBy: desc(schema.waMessages.createdAt), limit });
  return Promise.all(
    rows.reverse().map(async (m) => ({
      id: m.id,
      direction: m.direction,
      status: m.status,
      type: m.type,
      kind: m.kind,
      body: m.body,
      transcript: m.transcript,
      mediaUrl: m.mediaUrl ? await storage().signedUrl(m.mediaUrl) : null,
      createdAt: m.createdAt,
      sendAfter: m.sendAfter,
    })),
  );
}

export async function unknownSenders(actor: AnyActor) {
  requireAdmin(actor);
  return db.query.waMessages.findMany({ where: isNull(schema.waMessages.userId), orderBy: desc(schema.waMessages.createdAt), limit: 50 });
}
