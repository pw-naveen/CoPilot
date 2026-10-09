import { and, asc, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AnyActor } from "../actor";
import { now as clockNow } from "../clock";
import { isAtRisk } from "../schedule";
import { requireStaff, scopeWhere } from "../scope";

/**
 * How the whole book of accounts is doing, which is a different question from
 * the board's "what is on my desk today".
 *
 * An account is judged on the last post that actually went out, not on how busy
 * its calendar looks: a full schedule of slots nobody approves is exactly the
 * failure this page exists to surface.
 */

export const QUIET_DAYS = 7;
export const CRITICAL_DAYS = 14;
const WEEKS = 8;

export type Health = "critical" | "quiet" | "healthy" | "new";

/**
 * Silence is only meaningful once an account is live, so the clock starts at
 * activation for an account that has never posted. Without that a brand-new
 * account is "critical" on the day it finishes setup.
 */
function health(daysSince: number, everPosted: boolean, daysLive: number): Health {
  if (!everPosted && daysLive < QUIET_DAYS) return "new";
  if (daysSince >= CRITICAL_DAYS) return "critical";
  if (daysSince >= QUIET_DAYS) return "quiet";
  return "healthy";
}

export async function postingHealth(actor: AnyActor) {
  requireStaff(actor);
  const at = await clockNow();
  const users = await db.query.users.findMany({
    where: scopeWhere(actor, schema.users.id),
    orderBy: asc(schema.users.displayName),
  });
  const live = users.filter((u) => u.status === "active" || u.status === "paused");
  const ids = live.map((u) => u.id);
  if (!ids.length) return { at, rows: [], weeks: weekBuckets(at, []) };

  const [posts, slots] = await Promise.all([
    db
      .select({ userId: schema.posts.userId, status: schema.posts.status, publishAt: schema.posts.publishAt, approvedAt: schema.posts.approvedAt })
      .from(schema.posts)
      .where(and(inArray(schema.posts.userId, ids), isNotNull(schema.posts.approvedAt))),
    db
      .select({ userId: schema.slots.userId, status: schema.slots.status, publishAt: schema.slots.publishAt, approvalDeadline: schema.slots.approvalDeadline })
      .from(schema.slots)
      .where(inArray(schema.slots.userId, ids)),
  ]);

  // "Posted" means approved and the publish time has passed. Approved-for-next-
  // Tuesday is not yet a post, and counting it would hide a month of silence.
  const published = posts.filter((p) => p.status === "approved" && p.publishAt && p.publishAt <= at);

  const rows = live.map((u) => {
    const mine = published.filter((p) => p.userId === u.id);
    const last = mine.map((p) => p.publishAt!).sort((a, b) => +b - +a)[0] ?? null;
    const liveSince = u.approvedAt ?? u.createdAt;
    const days = (d: Date) => Math.floor((at.getTime() - d.getTime()) / 86_400_000);
    const daysSince = days(last ?? liveSince);
    const mySlots = slots.filter((s) => s.userId === u.id);
    return {
      id: u.id,
      name: u.displayName,
      email: u.email,
      org: u.org,
      status: u.status,
      lastPostedAt: last,
      daysSince,
      health: health(daysSince, !!last, days(liveSince)),
      postedLast30: mine.filter((p) => +p.publishAt! >= at.getTime() - 30 * 86_400_000).length,
      waiting: mySlots.filter((s) => s.status === "pending_approval" || s.status === "changes_requested").length,
      atRisk: mySlots.filter((s) => isAtRisk({ status: s.status, publishAt: s.publishAt }, at)).length,
      missed: mySlots.filter((s) => s.status === "missed").length,
    };
  });

  // Worst first: this page is read top-down and then abandoned.
  const rank: Record<Health, number> = { critical: 0, quiet: 1, healthy: 2, new: 3 };
  rows.sort((a, b) => rank[a.health] - rank[b.health] || b.daysSince - a.daysSince);

  return { at, rows, weeks: weekBuckets(at, published.map((p) => p.publishAt!)) };
}

/** Posts published per week for the last 8 weeks, oldest first. */
function weekBuckets(at: Date, dates: Date[]) {
  const start = new Date(at);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() + 1 - (WEEKS - 1) * 7);
  return Array.from({ length: WEEKS }, (_, i) => {
    const from = new Date(start.getTime() + i * 7 * 86_400_000);
    const to = new Date(from.getTime() + 7 * 86_400_000);
    return { from, count: dates.filter((d) => d >= from && d < to).length };
  });
}

/** Counts for the dashboard's tiles, across the actor's scope. */
export async function dashboardTotals(actor: AnyActor) {
  requireStaff(actor);
  const at = await clockNow();
  const users = await db.query.users.findMany({ where: scopeWhere(actor, schema.users.id) });
  const ids = users.map((u) => u.id);
  const slots = ids.length
    ? await db
        .select({ status: schema.slots.status, approvalDeadline: schema.slots.approvalDeadline, publishAt: schema.slots.publishAt })
        .from(schema.slots)
        .where(and(inArray(schema.slots.userId, ids), gte(schema.slots.publishAt, new Date(at.getTime() - 30 * 86_400_000)), lte(schema.slots.publishAt, new Date(at.getTime() + 45 * 86_400_000))))
    : [];
  const flagged = ids.length
    ? await db
        .select({ id: schema.posts.id })
        .from(schema.posts)
        .where(and(inArray(schema.posts.userId, ids), eq(schema.posts.flaggedForStaff, true), eq(schema.posts.status, "pending_approval")))
    : [];
  return {
    at,
    accounts: users.length,
    live: users.filter((u) => u.status === "active").length,
    suspended: users.filter((u) => u.status === "paused").length,
    settingUp: users.filter((u) => u.status === "onboarding" || u.status === "invited").length,
    pending: users.filter((u) => u.status === "pending").length,
    waiting: slots.filter((s) => s.status === "pending_approval" || s.status === "changes_requested").length,
    atRisk: slots.filter((s) => isAtRisk({ status: s.status, publishAt: s.publishAt }, at)).length,
    missed30: slots.filter((s) => s.status === "missed").length,
    heldForReview: flagged.length,
  };
}

/** The most recent drafts across the book, for the dashboard's activity list. */
export async function recentPosts(actor: AnyActor, limit = 8) {
  requireStaff(actor);
  const rows = await db
    .select({ post: schema.posts, user: schema.users })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.userId))
    .where(scopeWhere(actor, schema.posts.userId))
    .orderBy(desc(schema.posts.updatedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.post.id,
    status: r.post.status,
    summary: r.post.summary,
    flagged: r.post.flaggedForStaff,
    updatedAt: r.post.updatedAt,
    user: { id: r.user.id, name: r.user.displayName },
  }));
}
