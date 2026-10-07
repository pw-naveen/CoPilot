import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { SYSTEM } from "./actor";
import { audit } from "./audit";
import { now as clockNow } from "./clock";
import { getNumberSetting } from "./config";
import type { Persona } from "./persona-schema";
import { deferQuietHours, slotTimeline } from "./schedule";
import { activePersona } from "./services/persona";
import { alertStaff, createPreviewLink, fmt, queueDraft } from "./services/posts";
import { queueMessage } from "./whatsapp/outbox";

const OPEN = ["awaiting_input", "drafting", "pending_approval", "changes_requested"] as const;

/**
 * Runs every minute. Works backwards from each slot's publish time T:
 *   T−7d  no input → WhatsApp topic prompt with 2–3 pillar suggestions
 *   T−7d  input waiting → draft it
 *   T−5d  still no input → draft a suggested topic (flagged as such)
 *   T−72h not approved → reminder 1
 *   T−56h not approved → reminder 2, and alert the assigned staff
 *   T−48h not approved → missed; the user is told
 * Each step records when it fired, so the tick is idempotent.
 */
export async function schedulerTick() {
  const now = await clockNow();
  const promptDays = await getNumberSetting("limits.input_prompt_days", 7);
  const horizon = new Date(now.getTime() + (promptDays + 1) * 86_400_000);
  const slots = await db
    .select({ slot: schema.slots, user: schema.users })
    .from(schema.slots)
    .innerJoin(schema.users, eq(schema.users.id, schema.slots.userId))
    .where(and(eq(schema.users.status, "active"), inArray(schema.slots.status, [...OPEN]), lte(schema.slots.publishAt, horizon)));

  const withInput = new Set(
    (
      await db
        .select({ id: schema.inputBundles.slotId })
        .from(schema.inputBundles)
        .where(and(isNotNull(schema.inputBundles.slotId), inArray(schema.inputBundles.slotId, slots.map((s) => s.slot.id).concat(["00000000-0000-0000-0000-000000000000"]))))
    ).map((r) => r.id),
  );

  const counts = { prompts: 0, drafts: 0, autoDrafts: 0, reminders: 0, missed: 0 };
  for (const { slot, user } of slots) {
    const t = slotTimeline(slot.publishAt, user.timezone, promptDays);
    const quiet = (d: Date) => deferQuietHours(d, user.timezone);
    const send = (text: string, kind: "reminder" | "prompt" | "system", extra: Partial<Parameters<typeof queueMessage>[0]> = {}) =>
      queueMessage({ userId: user.id, phone: user.phoneE164, text, kind: kind === "prompt" ? "reminder" : kind, sendAfter: quiet(now), ...extra });

    // Deadline: anything not approved by T−48h is missed.
    if (now >= t.deadline) {
      await db.update(schema.slots).set({ status: "missed" }).where(eq(schema.slots.id, slot.id));
      if (slot.postId) await db.update(schema.posts).set({ status: "missed" }).where(eq(schema.posts.id, slot.postId));
      await audit(SYSTEM, { action: "slot.missed", entity: "slot", entityId: slot.id, userId: user.id, before: { status: slot.status } });
      await send(`The post for ${fmt(slot.publishAt, user.timezone)} wasn't approved in time, so it won't go out unless you reschedule it. Reply with a new day, or open your calendar to move it.`, "system");
      counts.missed++;
      continue;
    }

    if (slot.status === "awaiting_input") {
      if (withInput.has(slot.id)) {
        if (now.getTime() >= slot.publishAt.getTime() - 7 * 86_400_000) {
          await queueDraft(slot.id);
          counts.drafts++;
        }
        continue;
      }
      if (now >= t.autoDraftAt && !slot.autoDraftAt) {
        const topic = await suggestion(user.id);
        await db.update(schema.slots).set({ autoDraftAt: now }).where(eq(schema.slots.id, slot.id));
        await queueDraft(slot.id, { suggestedTopic: topic });
        counts.autoDrafts++;
        continue;
      }
      if (now >= t.topicPromptAt && !slot.topicPromptSentAt) {
        const ideas = await suggestions(user.id, 3);
        await db.update(schema.slots).set({ topicPromptSentAt: now }).where(eq(schema.slots.id, slot.id));
        const list = ideas.map((s, i) => `${i + 1}. ${s}`).join("\n");
        await send(
          `Your post for ${fmt(slot.publishAt, user.timezone)} is coming up. What would you like to share? A few ideas from your pillars:\n${list}\n\nReply with a topic, photo or voice note, or just a number.`,
          "prompt",
          { meta: { suggestions: ideas, slotId: slot.id } },
        );
        counts.prompts++;
      }
      continue;
    }

    if (slot.status !== "pending_approval" || !slot.postId) continue;
    const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, slot.postId) });
    if (!post || post.flaggedForStaff) continue;

    if (now >= t.reminder2At && !slot.reminder2At) {
      await db.update(schema.slots).set({ reminder2At: now, reminder1At: slot.reminder1At ?? now }).where(eq(schema.slots.id, slot.id));
      const link = await createPreviewLink(post.id);
      const text = `Last reminder: your post for ${fmt(slot.publishAt, user.timezone)} needs approval by ${fmt(t.deadline, user.timezone)} or it won't go out.\n${link}\nReply "approve", or tell me what to change.`;
      await send(text, "reminder", { emailFallback: { to: user.email, subject: "Approval needed today", text } });
      await alertStaff(user.id, `At risk: ${user.displayName}'s post for ${fmt(slot.publishAt, user.timezone)}`, `${user.displayName} hasn't approved the draft yet. Deadline: ${fmt(t.deadline, user.timezone)}.\n\nYou can approve or edit it on their behalf from the board.`);
      counts.reminders++;
    } else if (now >= t.reminder1At && !slot.reminder1At) {
      await db.update(schema.slots).set({ reminder1At: now }).where(eq(schema.slots.id, slot.id));
      const link = await createPreviewLink(post.id);
      const text = `Reminder: your draft for ${fmt(slot.publishAt, user.timezone)} is waiting. Please approve by ${fmt(t.deadline, user.timezone)}.\n${link}`;
      await send(text, "reminder", { emailFallback: { to: user.email, subject: "Your draft is waiting", text } });
      counts.reminders++;
    }
  }
  return counts;
}

/** 2–3 short topic ideas drawn from the user's content pillars, rotating over time. */
export async function suggestions(userId: string, n: number) {
  const p = (await activePersona(userId))?.json as Persona | undefined;
  const pillars = p?.content_pillars?.length ? p.content_pillars : [{ name: "Your work this month", description: "" }];
  const used = (await db.select({ id: schema.posts.id }).from(schema.posts).where(eq(schema.posts.userId, userId))).length;
  return Array.from({ length: Math.min(n, pillars.length) }, (_, i) => {
    const pl = pillars[(used + i) % pillars.length];
    return `${pl.name}${pl.description ? `: ${pl.description.replace(/\.$/, "")}` : ""}`;
  });
}

async function suggestion(userId: string) {
  return (await suggestions(userId, 1))[0];
}

