import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { db, schema } from "@/db";
import type { AnyActor } from "../actor";
import { audit } from "../audit";
import { now as clockNow } from "../clock";
import { getNumberSetting } from "../config";
import { badRequest, conflict, notFound } from "../errors";
import {
  applyMonthlyCap,
  approvalDeadline,
  earliestNewSlot,
  horizonEnd,
  monthKey,
  slotTimes,
  validateCadence,
  type Cadence,
} from "../schedule";
import { assertUserAccess } from "../scope";

export const cadenceInput = z.object({
  postsPerWeek: z.number().int(),
  weekdays: z.array(z.number().int()),
  times: z.array(z.string()),
});

export async function currentCadence(userId: string) {
  return db.query.cadences.findFirst({ where: eq(schema.cadences.userId, userId), orderBy: desc(schema.cadences.effectiveFrom) });
}

async function cap(userId: string) {
  const c = await currentCadence(userId);
  return c?.monthlyCap ?? (await getNumberSetting("limits.monthly_cap", 20));
}

/** Slot counts per user-local month, for the cap. Skipped slots don't count. */
async function countsByMonth(userId: string, tz: string, from: Date) {
  const rows = await db
    .select({ publishAt: schema.slots.publishAt })
    .from(schema.slots)
    .where(and(eq(schema.slots.userId, userId), gte(schema.slots.publishAt, DateTime.fromJSDate(from).minus({ months: 1 }).toJSDate()), ne(schema.slots.status, "skipped")));
  const m = new Map<string, number>();
  for (const r of rows) m.set(monthKey(r.publishAt, tz), (m.get(monthKey(r.publishAt, tz)) ?? 0) + 1);
  return m;
}

/** What the cadence would produce over the next `weeks`, for the calendar preview. */
export async function previewCadence(c: Cadence, tz: string, weeks = 4) {
  const err = validateCadence(c);
  if (err) throw badRequest(err);
  const now = await clockNow();
  const from = earliestNewSlot(now);
  const times = applyMonthlyCap(slotTimes(c, tz, from, new Date(from.getTime() + weeks * 7 * 86_400_000)), new Map(), 20, tz);
  return times.map((t) => ({ publishAt: t.toISOString(), approvalDeadline: approvalDeadline(t).toISOString() }));
}

export async function saveCadence(actor: AnyActor, userId: string, input: Cadence) {
  await assertUserAccess(actor, userId);
  const err = validateCadence(input);
  if (err) throw badRequest(err);
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) throw notFound();
  // Keep weekdays in calendar order so times line up predictably.
  const order = input.weekdays.map((d, i) => ({ d, t: input.times[i] })).sort((a, b) => a.d - b.d);
  const before = await currentCadence(userId);
  const [row] = await db
    .insert(schema.cadences)
    .values({
      userId,
      postsPerWeek: input.postsPerWeek,
      weekdays: order.map((o) => o.d),
      times: order.map((o) => o.t),
      monthlyCap: before?.monthlyCap ?? (await getNumberSetting("limits.monthly_cap", 20)),
      effectiveFrom: await clockNow(),
    })
    .returning();
  await audit(actor, { action: "cadence.update", entity: "cadence", entityId: row.id, userId, before: before && { postsPerWeek: before.postsPerWeek, weekdays: before.weekdays, times: before.times }, after: input });
  if (u.status === "active") await regenerateFutureSlots(userId);
  return row;
}

/**
 * Rolling generation: fills slots up to 6 weeks ahead. Never creates a slot whose
 * timeline has already started, and never exceeds the monthly cap.
 */
export async function generateSlots(userId: string) {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  const c = await currentCadence(userId);
  if (!u || !c || u.status !== "active") return [];
  const now = await clockNow();
  const from = earliestNewSlot(now);
  const until = horizonEnd(now);
  const existing = await db.query.slots.findMany({ where: and(eq(schema.slots.userId, userId), gte(schema.slots.publishAt, from), lt(schema.slots.publishAt, until)) });
  const taken = new Set(existing.map((s) => s.publishAt.getTime()));
  const candidates = slotTimes(c, u.timezone, from, until).filter((t) => !taken.has(t.getTime()));
  const kept = applyMonthlyCap(candidates, await countsByMonth(userId, u.timezone, from), c.monthlyCap, u.timezone);
  if (!kept.length) return [];
  return db
    .insert(schema.slots)
    .values(kept.map((publishAt) => ({ userId, publishAt, approvalDeadline: approvalDeadline(publishAt) })))
    .returning();
}

/** After a cadence change: drop future slots nobody has started on, then regenerate. */
export async function regenerateFutureSlots(userId: string) {
  const now = await clockNow();
  const bundles = db.select({ id: schema.inputBundles.slotId }).from(schema.inputBundles).where(eq(schema.inputBundles.userId, userId));
  const linked = (await bundles).map((b) => b.id).filter(Boolean) as string[];
  const unfilled = await db.query.slots.findMany({
    where: and(
      eq(schema.slots.userId, userId),
      gt(schema.slots.publishAt, now),
      eq(schema.slots.status, "awaiting_input"),
      isNull(schema.slots.postId),
      eq(schema.slots.isExtra, false),
    ),
  });
  const removable = unfilled.filter((s) => !linked.includes(s.id)).map((s) => s.id);
  if (removable.length) await db.delete(schema.slots).where(inArray(schema.slots.id, removable));
  return generateSlots(userId);
}

/**
 * An extra post on a date the user named. Uses their usual time for that weekday,
 * or their first slot time. Respects the 48-hour rule and the monthly cap.
 */
export async function createExtraSlot(userId: string, localDate: string) {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  const c = await currentCadence(userId);
  if (!u || !c) throw notFound();
  const day = DateTime.fromISO(localDate, { zone: u.timezone });
  if (!day.isValid) throw badRequest("Unknown date");
  const i = c.weekdays.indexOf(day.weekday);
  const [h, m] = (c.times[i] ?? c.times[0]).split(":").map(Number);
  const publishAt = day.set({ hour: h, minute: m, second: 0, millisecond: 0 }).toJSDate();
  const now = await clockNow();
  if (approvalDeadline(publishAt) <= now) throw conflict("Too soon: posts need approval 48 hours ahead");
  const counts = await countsByMonth(userId, u.timezone, publishAt);
  if ((counts.get(monthKey(publishAt, u.timezone)) ?? 0) >= c.monthlyCap) throw conflict(`You've reached ${c.monthlyCap} posts for that month`);
  const [row] = await db.insert(schema.slots).values({ userId, publishAt, approvalDeadline: approvalDeadline(publishAt), isExtra: true }).returning();
  return row;
}

export async function listSlots(actor: AnyActor, userId: string, opts: { from?: Date; to?: Date } = {}) {
  await assertUserAccess(actor, userId);
  const now = await clockNow();
  const from = opts.from ?? DateTime.fromJSDate(now).minus({ weeks: 2 }).toJSDate();
  const to = opts.to ?? horizonEnd(now);
  const slots = await db.query.slots.findMany({
    where: and(eq(schema.slots.userId, userId), gte(schema.slots.publishAt, from), lt(schema.slots.publishAt, to)),
    orderBy: asc(schema.slots.publishAt),
  });
  const postIds = slots.map((s) => s.postId).filter(Boolean) as string[];
  const posts = postIds.length ? await db.query.posts.findMany({ where: inArray(schema.posts.id, postIds) }) : [];
  return slots.map((s) => {
    const p = posts.find((x) => x.id === s.postId);
    return { ...s, post: p ? { id: p.id, summary: p.summary, topic: p.topic, status: p.status, suggestedTopic: p.suggestedTopic, flaggedForStaff: p.flaggedForStaff } : null };
  });
}

/** Skip a slot (user or staff). Only slots that aren't finished can be skipped. */
export async function skipSlot(actor: AnyActor, slotId: string) {
  const slot = await db.query.slots.findFirst({ where: eq(schema.slots.id, slotId) });
  if (!slot) throw notFound();
  await assertUserAccess(actor, slot.userId);
  if (["approved", "missed", "skipped"].includes(slot.status)) throw conflict("This slot is already closed");
  await db.update(schema.slots).set({ status: "skipped" }).where(eq(schema.slots.id, slotId));
  if (slot.postId) await db.update(schema.posts).set({ status: "skipped" }).where(eq(schema.posts.id, slot.postId));
  await audit(actor, { action: "slot.skip", entity: "slot", entityId: slotId, userId: slot.userId, before: { status: slot.status } });
}
