import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "@/db";
import * as ai from "../ai";
import { audit } from "../audit";
import { now as clockNow } from "../clock";
import { getNumberSetting } from "../config";
import { addJob, queue } from "../queue";
import { newKey, storage } from "../storage";
import { generateSlots } from "../services/cadence";
import { slotTimeline } from "../schedule";
import type { GatewayEvent, InboundMessage } from "./gateway";
import { gateway, storeStatus } from "./index";
import { queueMessage } from "./outbox";

const inline = () => process.env.JOBS_INLINE === "1";
export const DONE_WORDS = /^(done|that'?s all|that is all|send( it)?|go)[.!]*$/i;
export const APPROVAL_WORDS = /^(ok(ay)?|approve[d]?|looks good|lgtm|yes|go ahead|perfect|👍|✅)[.! ]*$/i;

/** Webhook / mock entry point: runs in the worker (or inline in tests). */
export async function handleGatewayEvent(e: GatewayEvent) {
  if (e.kind === "connection") await storeStatus({ state: e.state });
  else if (e.kind === "qr") await storeStatus({ state: "connecting", qr: e.qr });
  else await ingest(e.message);
}

/** Webhook route → worker. The web app never talks to Evolution itself. */
export async function enqueueWebhook(source: "evolution" | "mock", payload: unknown) {
  if (inline()) return processWebhook(source, payload);
  await addJob("inbound", "webhook", { source, payload }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
}

export async function processWebhook(source: "evolution" | "mock", payload: unknown) {
  const g = source === "mock" ? (await import("./index")).mockGateway() : gateway();
  if (source === "mock") g.onMessage(handleGatewayEvent);
  return g.receive(payload);
}

/** Store one inbound message and route it: verification, or into the user's open bundle. */
export async function ingest(msg: InboundMessage) {
  if (await db.query.waMessages.findFirst({ where: eq(schema.waMessages.waMessageId, msg.id) })) return; // duplicate delivery

  const user = await db.query.users.findFirst({ where: eq(schema.users.phoneE164, msg.from) });
  const known = user && (user.whatsappVerifiedAt || user.onboardingStep >= 7);
  if (!user || !known) {
    // Unknown numbers get no reply; staff can see them in settings.
    await db.insert(schema.waMessages).values({ phoneE164: msg.from, direction: "in", status: "received", waMessageId: msg.id, type: msg.type, body: msg.text ?? msg.caption ?? null, rawJson: msg.raw as object });
    await audit({ type: "system", id: "whatsapp" }, { action: "wa.unknown_sender", entity: "wa_message", entityId: msg.id, after: { from: msg.from } });
    return;
  }

  // Media: download, store, transcribe voice notes, describe images.
  let mediaKey: string | null = null;
  let transcript: string | null = null;
  if (msg.type !== "text") {
    try {
      const file = await downloadVia(msg);
      const kind = msg.type === "audio" ? "audio" : msg.type === "image" ? "image" : "doc";
      mediaKey = newKey(user.id, kind, file.mime);
      await storage().put(mediaKey, file.data, file.mime);
      if (msg.type === "audio") transcript = await ai.transcribe(user.id, file.data, file.mime);
      if (msg.type === "image") {
        const description = await ai.describeImage(user.id, file.data, file.mime).catch(() => null);
        await db.insert(schema.media).values({ userId: user.id, storageKey: mediaKey, mimeType: file.mime, visionDescription: description });
      }
    } catch (err) {
      console.error("[inbound] media failed", err);
    }
  }

  const text = (msg.text ?? msg.caption ?? "").trim();
  const [row] = await db
    .insert(schema.waMessages)
    .values({
      userId: user.id,
      phoneE164: msg.from,
      direction: "in",
      status: "received",
      waMessageId: msg.id,
      type: msg.type === "text" && /https?:\/\//.test(text) ? "link" : msg.type,
      body: text || null,
      mediaUrl: mediaKey,
      transcript,
      rawJson: msg.raw as object,
    })
    .returning();

  if (!user.whatsappVerifiedAt) return handleVerification(user, text);
  if (user.status === "paused") return;

  // Attach to the open bundle (or start one), then debounce.
  let bundle = await db.query.inputBundles.findFirst({
    where: and(eq(schema.inputBundles.userId, user.id), isNull(schema.inputBundles.closedAt)),
    orderBy: desc(schema.inputBundles.createdAt),
  });
  // Stamped with the scheduler clock so the debounce works under dev time travel too.
  const at = await clockNow();
  if (!bundle) [bundle] = await db.insert(schema.inputBundles).values({ userId: user.id, createdAt: at, updatedAt: at }).returning();
  else await db.update(schema.inputBundles).set({ updatedAt: at }).where(eq(schema.inputBundles.id, bundle.id));
  await db.update(schema.waMessages).set({ bundleId: bundle.id }).where(eq(schema.waMessages.id, row.id));

  const parts = await db.query.waMessages.findMany({ where: eq(schema.waMessages.bundleId, bundle.id) });
  const { latestPendingPost } = await import("../services/posts");
  const quickApproval = parts.length === 1 && APPROVAL_WORDS.test(text) && !!(await latestPendingPost(user.id));
  if (DONE_WORDS.test(text) || quickApproval) return processNow(bundle.id);
  await scheduleBundle(bundle.id);
}

async function downloadVia(msg: InboundMessage) {
  if (msg.media) return msg.media;
  return gateway().downloadMedia(msg);
}

async function processNow(bundleId: string) {
  const { processBundle } = await import("./bundle");
  if (inline()) return processBundle(bundleId);
  await queue("inbound").remove(`bundle-${bundleId}`).catch(() => {});
  await addJob("inbound", "bundle", { bundleId }, { jobId: `bundle-${bundleId}-now` });
}

/** Wait for a few minutes of silence before treating fragments as one input. */
async function scheduleBundle(bundleId: string) {
  if (inline()) return; // tests flush with processDueBundles()
  const delay = (await getNumberSetting("limits.debounce_seconds", 180)) * 1000;
  const jobId = `bundle-${bundleId}`;
  await queue("inbound").remove(jobId).catch(() => {});
  await addJob("inbound", "bundle", { bundleId }, { jobId, delay });
}

/** Safety net (and the test/dev path): process open bundles that have gone quiet. */
export async function processDueBundles() {
  const quiet = (await getNumberSetting("limits.debounce_seconds", 180)) * 1000;
  const cutoff = new Date((await clockNow()).getTime() - quiet);
  const due = await db.query.inputBundles.findMany({ where: and(isNull(schema.inputBundles.closedAt), lte(schema.inputBundles.updatedAt, cutoff)) });
  const { processBundle } = await import("./bundle");
  for (const b of due) await processBundle(b.id);
  return due.length;
}

// ── verification (onboarding step 7) ──────────────────────────────────────

export const fmtLocal = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toFormat("cccc d LLL, h:mma").replace("AM", "am").replace("PM", "pm");

async function handleVerification(user: typeof schema.users.$inferSelect, text: string) {
  const code = user.whatsappVerifyCode;
  if (!code) return;
  const words = text.toLowerCase();
  if (!words.includes(code)) {
    await queueMessage({ userId: user.id, phone: user.phoneE164, kind: "verify", text: `To confirm this number, reply with YES ${code}.` });
    return;
  }
  await db
    .update(schema.users)
    .set({ whatsappVerifiedAt: new Date(), whatsappVerifyCode: null, status: "active" })
    .where(eq(schema.users.id, user.id));
  await audit({ type: "user", id: user.id, name: user.displayName, email: user.email }, { action: "whatsapp.verified", entity: "user", entityId: user.id, userId: user.id, after: { phone: user.phoneE164 } });
  await generateSlots(user.id);
  await sendWelcome(user.id);
}

export async function sendWelcome(userId: string) {
  const u = (await db.query.users.findFirst({ where: eq(schema.users.id, userId) }))!;
  const first = await db.query.slots.findFirst({ where: eq(schema.slots.userId, userId), orderBy: (s, { asc }) => asc(s.publishAt) });
  let text: string;
  if (first) {
    const t = slotTimeline(first.publishAt, u.timezone);
    // The draft goes out between T−5 and T−4 days; promise the later bound.
    const draftBy = new Date(first.publishAt.getTime() - 4 * 86_400_000);
    text =
      `Hi ${u.displayName}, you're all set. I'll be sending your drafts here soon. ` +
      `Based on your calendar, your first post goes out on ${fmtLocal(first.publishAt, u.timezone)}, so I'll send the draft by ${fmtLocal(draftBy, u.timezone)} ` +
      `and need your approval by ${fmtLocal(t.deadline, u.timezone)}. Anytime you have a topic, event, photo or thought you'd like to share, just send it to me here. Voice notes work too.`;
  } else {
    text = `Hi ${u.displayName}, you're all set. Anytime you have a topic, event, photo or thought you'd like to share, just send it to me here. Voice notes work too.`;
  }
  await queueMessage({ userId, phone: u.phoneE164, kind: "welcome", text });
}
