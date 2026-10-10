import { and, asc, eq, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { now as clockNow } from "../clock";
import { sendEmail } from "../email";
import { addJob, redis } from "../queue";
import { gateway } from "./index";

/**
 * Outbound WhatsApp, kept safe for an unofficial client: only verified users, mostly
 * replies, spaced a few seconds apart with a typing indicator. If the connection is
 * down messages wait in the queue; drafts and reminders fall back to email after 2h.
 */
export const SPACING_MS = 4000;
export const EMAIL_FALLBACK_MS = 2 * 3600_000;
const inline = () => process.env.JOBS_INLINE === "1";

export type OutKind = "reply" | "draft" | "reminder" | "welcome" | "verify" | "system";

export async function queueMessage(m: {
  userId: string;
  phone: string;
  text: string;
  kind: OutKind;
  sendAfter?: Date;
  media?: { url: string; mime: string; storageKey: string };
  emailFallback?: { to: string; subject: string; text: string };
  /** Extra context kept with the message, e.g. the topic suggestions a prompt offered. */
  meta?: Record<string, unknown>;
}) {
  const at = m.sendAfter ?? (await clockNow());
  const [row] = await db
    .insert(schema.waMessages)
    .values({
      userId: m.userId,
      phoneE164: m.phone,
      direction: "out",
      status: "queued",
      type: m.media ? "image" : "text",
      body: m.text,
      mediaUrl: m.media?.storageKey ?? null,
      kind: m.kind,
      sendAfter: at,
      emailFallback: m.emailFallback ?? null,
      rawJson: m.media || m.meta ? { ...(m.media ? { mediaUrl: m.media.url, mime: m.media.mime } : {}), ...(m.meta ? { meta: m.meta } : {}) } : null,
    })
    .returning();
  if (inline()) {
    if (at <= (await clockNow())) await deliver(row.id);
  } else {
    await addJob("outbox", "send", { id: row.id }, { delay: Math.max(0, at.getTime() - Date.now()), jobId: `out-${row.id}` });
  }
  return row;
}

async function spacing() {
  if (inline()) return;
  const r = redis();
  for (;;) {
    const last = Number((await r.get("wa:last_send")) ?? 0);
    const wait = last + SPACING_MS - Date.now();
    if (wait <= 0) break;
    await new Promise((res) => setTimeout(res, wait));
  }
  await r.set("wa:last_send", String(Date.now()));
}

/** Try to send one queued message. Returns false when it should be retried later. */
export async function deliver(id: string): Promise<boolean> {
  const m = await db.query.waMessages.findFirst({ where: eq(schema.waMessages.id, id) });
  if (!m || m.status !== "queued") return true;
  const now = await clockNow();
  if (m.sendAfter && m.sendAfter > now) return false;
  // Never message anyone who isn't a verified user, except the verification message itself.
  const u = m.userId ? await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) }) : null;
  if (!u || (m.kind !== "verify" && !u.whatsappVerifiedAt) || u.status === "paused") {
    await db.update(schema.waMessages).set({ status: "failed" }).where(eq(schema.waMessages.id, id));
    return true;
  }
  try {
    await spacing();
    const g = await gateway();
    await g.sendTyping?.(m.phoneE164, Math.min(3000, 600 + (m.body?.length ?? 0) * 8));
    const media = m.rawJson as { mediaUrl?: string; mime?: string } | null;
    const res = media?.mediaUrl
      ? await g.sendMedia(m.phoneE164, { url: media.mediaUrl, mime: media.mime ?? "image/jpeg", caption: m.body ?? "" })
      : await g.sendText(m.phoneE164, m.body ?? "");
    await db.update(schema.waMessages).set({ status: "sent", sentAt: new Date(), waMessageId: res.id || null, attempts: m.attempts + 1 }).where(eq(schema.waMessages.id, id));
    return true;
  } catch (err) {
    const age = now.getTime() - (m.sendAfter ?? m.createdAt).getTime();
    if (m.emailFallback && age >= EMAIL_FALLBACK_MS) {
      const e = m.emailFallback as { to: string; subject: string; text: string };
      await sendEmail(e.to, e.subject, e.text);
      await db.update(schema.waMessages).set({ status: "emailed", attempts: m.attempts + 1 }).where(eq(schema.waMessages.id, id));
      return true;
    }
    await db.update(schema.waMessages).set({ attempts: m.attempts + 1 }).where(eq(schema.waMessages.id, id));
    if (!inline()) console.warn(`[outbox] ${id} not sent (${String(err).slice(0, 120)}); will retry`);
    return false;
  }
}

/** Every minute: retry queued messages that are due (connection back, quiet hours over). */
export async function sweepOutbox() {
  const due = await db.query.waMessages.findMany({
    where: and(eq(schema.waMessages.direction, "out"), eq(schema.waMessages.status, "queued"), lte(schema.waMessages.sendAfter, await clockNow())),
    orderBy: asc(schema.waMessages.sendAfter),
    limit: 200,
  });
  let sent = 0;
  for (const m of due) if (await deliver(m.id)) sent++;
  return { due: due.length, done: sent };
}
