import { and, asc, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "@/db";
import * as ai from "../ai";
import { audit } from "../audit";
import { now as clockNow } from "../clock";
import { createExtraSlot } from "../services/cadence";
import { applyPersonaFeedback } from "../services/persona";
import { approvePost, fmt, latestPendingPost, queueDraft, requestChanges } from "../services/posts";
import { DONE_WORDS } from "./inbound";
import { queueMessage } from "./outbox";

const DRAFT_WINDOW_DAYS = 7; // inputs for later slots wait until T−7d to be drafted
const INPUT_CLOSES_HOURS = 72; // a slot stops taking new input 72h before publishing

/**
 * One bundle = the fragments a user sent before going quiet (or saying "done").
 * Classify it and act: approve, revise, new idea → slot, preference, question.
 */
export async function processBundle(bundleId: string) {
  const claimed = await db.update(schema.inputBundles).set({ closedAt: new Date() }).where(and(eq(schema.inputBundles.id, bundleId), isNull(schema.inputBundles.closedAt))).returning();
  if (!claimed.length) return; // already processed
  const bundle = claimed[0];
  const user = (await db.query.users.findFirst({ where: eq(schema.users.id, bundle.userId) }))!;
  const msgs = await db.query.waMessages.findMany({ where: eq(schema.waMessages.bundleId, bundleId), orderBy: asc(schema.waMessages.createdAt) });
  const reply = (text: string) => queueMessage({ userId: user.id, phone: user.phoneE164, kind: "reply", text });

  // A thin idea from the last bundle waits for this one's detail.
  const previous = await db.query.inputBundles.findFirst({
    where: and(eq(schema.inputBundles.userId, user.id), eq(schema.inputBundles.intent, "new_idea"), isNull(schema.inputBundles.slotId), isNotNull(schema.inputBundles.closedAt)),
    orderBy: desc(schema.inputBundles.createdAt),
  });
  const waiting = previous && previous.id !== bundleId && (previous.extractedJson as { awaiting_detail?: boolean } | null)?.awaiting_detail && Date.now() - previous.createdAt.getTime() < 24 * 3600_000;

  // "done" only closes the bundle; it isn't part of the content.
  const textOf = (ms: typeof msgs) =>
    ms
      .filter((m) => !(m.body && DONE_WORDS.test(m.body.trim()) && !m.mediaUrl))
      .map((m) => [m.body, m.transcript && `(voice note) ${m.transcript}`].filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n");
  let text = textOf(msgs);
  if (waiting) {
    const prevMsgs = await db.query.waMessages.findMany({ where: eq(schema.waMessages.bundleId, previous!.id) });
    text = `${textOf(prevMsgs)}\n${text}`;
    // fold the earlier fragments into this bundle so the draft sees everything
    await db.update(schema.waMessages).set({ bundleId }).where(eq(schema.waMessages.bundleId, previous!.id));
    await db.update(schema.inputBundles).set({ intent: "other", extractedJson: { merged_into: bundleId } }).where(eq(schema.inputBundles.id, previous!.id));
  }
  // "2" in reply to a topic prompt picks that suggestion.
  const pick = text.trim().match(/^([1-3])[.)]?$/);
  if (pick) {
    const prompt = await db.query.waMessages.findFirst({
      where: and(eq(schema.waMessages.userId, user.id), eq(schema.waMessages.direction, "out"), isNotNull(schema.waMessages.rawJson)),
      orderBy: desc(schema.waMessages.createdAt),
    });
    const meta = (prompt?.rawJson as { meta?: { suggestions?: string[]; slotId?: string } } | null)?.meta;
    const chosen = meta?.suggestions?.[Number(pick[1]) - 1];
    if (chosen && meta?.slotId) {
      const slot = await db.query.slots.findFirst({ where: and(eq(schema.slots.id, meta.slotId), eq(schema.slots.status, "awaiting_input")) });
      if (slot) {
        await db.update(schema.inputBundles).set({ intent: "new_idea", extractedJson: { topic: chosen, picked: Number(pick[1]) }, slotId: slot.id }).where(eq(schema.inputBundles.id, bundleId));
        await db.update(schema.waMessages).set({ body: `${text} — ${chosen}` }).where(eq(schema.waMessages.id, msgs[0].id));
        await reply(`Great, I'll write about "${chosen}" for ${DateTime.fromJSDate(slot.publishAt, { zone: user.timezone }).toFormat("cccc d LLL")}.`);
        await queueDraft(slot.id);
        return;
      }
    }
  }

  const hasMedia = msgs.some((m) => m.mediaUrl && m.type !== "audio");
  const pending = await latestPendingPost(user.id);
  const today = DateTime.fromJSDate(await clockNow(), { zone: user.timezone }).toISODate()!;
  const { data: intent } = await ai.classifyIntent(user.id, text || "(media only)", { pendingDraft: !!pending, today, timezone: user.timezone, hasMedia });

  await db.update(schema.inputBundles).set({ intent: intent.intent, extractedJson: intent }).where(eq(schema.inputBundles.id, bundleId));
  await audit({ type: "system", id: "whatsapp" }, { action: "wa.bundle", entity: "input_bundle", entityId: bundleId, userId: user.id, after: { intent: intent.intent, messages: msgs.length } });

  switch (intent.intent) {
    case "approval": {
      if (!pending) return reply("There's no draft waiting for your approval right now.");
      await approvePost({ type: "user", id: user.id, name: user.displayName, email: user.email }, pending.id, "whatsapp");
      return; // approvePost sends the confirmation
    }
    case "feedback": {
      if (!pending) return reply("There's no draft waiting right now. Send me a topic any time and I'll write one.");
      await reply("Got it, revising now. I'll send the new version shortly.");
      await requestChanges({ type: "user", id: user.id, name: user.displayName, email: user.email }, pending.id, intent.feedback || text, "whatsapp");
      return;
    }
    case "persona_preference": {
      const res = await applyPersonaFeedback(user.id, "", "preference", intent.preference || text, `user:${user.id}`);
      return reply(res.message || "Noted. I'll write that way from now on.");
    }
    case "question": {
      const upcoming = await db.query.slots.findMany({ where: and(eq(schema.slots.userId, user.id), gt(schema.slots.publishAt, await clockNow())), orderBy: asc(schema.slots.publishAt), limit: 4 });
      const schedule = upcoming.map((s) => `- ${fmt(s.publishAt, user.timezone)}: ${s.status.replace(/_/g, " ")}`).join("\n");
      const { data } = await ai.answerQuestion(user.id, intent.question || text, schedule);
      return reply(data.answer);
    }
    case "new_idea": {
      if (!intent.enough_detail) {
        await db.update(schema.inputBundles).set({ extractedJson: { ...intent, awaiting_detail: true } }).where(eq(schema.inputBundles.id, bundleId));
        return reply(intent.follow_up || "Tell me a little more: what happened, and what should people take away?");
      }
      return assignIdea(user, bundleId, intent.requested_date);
    }
    default:
      return reply("Hi! Send me a topic, event, photo or voice note whenever you have one, and I'll turn it into a draft.");
  }
}

/** Put a new idea into the requested date's slot, or the next free slot still open for input. */
async function assignIdea(user: typeof schema.users.$inferSelect, bundleId: string, requestedDate: string) {
  const now = await clockNow();
  const reply = (text: string) => queueMessage({ userId: user.id, phone: user.phoneE164, kind: "reply", text });
  const open = await db.query.slots.findMany({
    where: and(eq(schema.slots.userId, user.id), eq(schema.slots.status, "awaiting_input"), isNull(schema.slots.postId), gt(schema.slots.publishAt, new Date(now.getTime() + INPUT_CLOSES_HOURS * 3600_000))),
    orderBy: asc(schema.slots.publishAt),
  });
  const taken = new Set(
    (await db.select({ id: schema.inputBundles.slotId }).from(schema.inputBundles).where(and(eq(schema.inputBundles.userId, user.id), isNotNull(schema.inputBundles.slotId)))).map((r) => r.id),
  );
  const free = open.filter((s) => !taken.has(s.id));

  let slot: (typeof free)[number] | undefined;
  let note = "";
  if (requestedDate) {
    slot = free.find((s) => DateTime.fromJSDate(s.publishAt, { zone: user.timezone }).toISODate() === requestedDate);
    if (!slot) {
      try {
        slot = await createExtraSlot(user.id, requestedDate);
      } catch (err) {
        note = ` (${(err as Error).message.replace(/\.$/, "")}, so I've used the next free slot instead)`;
      }
    }
  }
  slot ??= free[0];
  if (!slot) {
    await db.update(schema.inputBundles).set({ extractedJson: { queued: true } }).where(eq(schema.inputBundles.id, bundleId));
    return reply("Thanks, saved. Your upcoming slots are all taken, so I'll keep this for the next free one.");
  }
  await db.update(schema.inputBundles).set({ slotId: slot.id }).where(eq(schema.inputBundles.id, bundleId));
  await reply(`Got it, I'll draft this for ${DateTime.fromJSDate(slot.publishAt, { zone: user.timezone }).toFormat("cccc d LLL")}${note}.`);
  // Inside the draft window: write it now. Otherwise the scheduler picks it up at T−7d.
  if (slot.publishAt.getTime() - now.getTime() <= DRAFT_WINDOW_DAYS * 86_400_000) await queueDraft(slot.id);
}
