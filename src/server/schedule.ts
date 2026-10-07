import { DateTime } from "luxon";

/**
 * Scheduling maths, all in the user's time zone. Pure functions: no database, no
 * clock — callers pass `now` — so they can be tested across zones and DST changes.
 */

export const APPROVAL_LEAD_HOURS = 48;
export const HORIZON_WEEKS = 6;
/** New slots are only created when there is still time to ask for input and draft. */
export const MIN_LEAD_DAYS = 5;
export const QUIET_START = 22; // 10pm
export const QUIET_END = 8; // 8am

export type Cadence = { postsPerWeek: number; weekdays: number[]; times: string[] };

/** Exactly 48 hours of real time before publishing, whatever the local clock does. */
export function approvalDeadline(publishAt: Date): Date {
  return new Date(publishAt.getTime() - APPROVAL_LEAD_HOURS * 3_600_000);
}

export function validateCadence(c: Cadence): string | null {
  if (![2, 4].includes(c.postsPerWeek)) return "Choose 2 or 4 posts a week";
  if (c.weekdays.length !== c.postsPerWeek) return `Pick ${c.postsPerWeek} days`;
  if (new Set(c.weekdays).size !== c.weekdays.length) return "Pick different days";
  if (c.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return "Unknown weekday";
  if (c.times.length !== c.weekdays.length) return "Pick a time for each day";
  if (c.times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return "Times must be HH:mm";
  return null;
}

/** Every publish instant the cadence produces in [from, until), in chronological order. */
export function slotTimes(c: Cadence, tz: string, from: Date, until: Date): Date[] {
  const out: Date[] = [];
  let day = DateTime.fromJSDate(from, { zone: tz }).startOf("day");
  const end = DateTime.fromJSDate(until, { zone: tz });
  while (day < end) {
    const i = c.weekdays.indexOf(day.weekday);
    if (i >= 0) {
      const [h, m] = c.times[i].split(":").map(Number);
      // Luxon moves non-existent local times (DST gaps) forward; that's the right call here.
      const at = day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (at.toMillis() >= from.getTime() && at < end) out.push(at.toJSDate());
    }
    day = day.plus({ days: 1 });
  }
  return out;
}

export const monthKey = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toFormat("yyyy-LL");

/**
 * Applies the monthly cap: keeps candidates in date order until the month (existing
 * slots included) reaches the cap, dropping the last slots of the month.
 */
export function applyMonthlyCap(candidates: Date[], existingPerMonth: Map<string, number>, cap: number, tz: string): Date[] {
  const counts = new Map(existingPerMonth);
  const kept: Date[] = [];
  for (const d of [...candidates].sort((a, b) => a.getTime() - b.getTime())) {
    const k = monthKey(d, tz);
    const n = counts.get(k) ?? 0;
    if (n >= cap) continue;
    counts.set(k, n + 1);
    kept.push(d);
  }
  return kept;
}

/** Reminders never go out between 10pm and 8am local time; they move to the next 8am. */
export function deferQuietHours(at: Date, tz: string): Date {
  const local = DateTime.fromJSDate(at, { zone: tz });
  if (local.hour >= QUIET_START) return local.plus({ days: 1 }).set({ hour: QUIET_END, minute: 0, second: 0, millisecond: 0 }).toJSDate();
  if (local.hour < QUIET_END) return local.set({ hour: QUIET_END, minute: 0, second: 0, millisecond: 0 }).toJSDate();
  return at;
}

/**
 * The timeline the scheduler works backwards from (T = publish time):
 *   T−7d topic prompt · T−5d auto-draft if no input · T−72h reminder 1 ·
 *   T−56h reminder 2 + staff alert · T−48h deadline (missed if not approved)
 */
export function slotTimeline(publishAt: Date, tz: string, promptLeadDays = 7) {
  const T = DateTime.fromJSDate(publishAt, { zone: tz });
  const hours = (h: number) => new Date(publishAt.getTime() - h * 3_600_000);
  return {
    topicPromptAt: deferQuietHours(T.minus({ days: promptLeadDays }).toJSDate(), tz),
    autoDraftAt: T.minus({ days: 5 }).toJSDate(),
    reminder1At: deferQuietHours(hours(72), tz),
    reminder2At: deferQuietHours(hours(56), tz),
    deadline: approvalDeadline(publishAt),
  };
}

/** A slot is at risk inside 72 hours of its publish time without an approved post. */
export function isAtRisk(slot: { publishAt: Date; status: string }, now: Date) {
  return (
    !["approved", "missed", "skipped"].includes(slot.status) && slot.publishAt.getTime() - now.getTime() <= 72 * 3_600_000 && slot.publishAt > now
  );
}

export function earliestNewSlot(now: Date) {
  return new Date(now.getTime() + MIN_LEAD_DAYS * 86_400_000);
}

export function horizonEnd(now: Date) {
  return new Date(now.getTime() + HORIZON_WEEKS * 7 * 86_400_000);
}
