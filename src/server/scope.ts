import { and, eq, inArray, type SQL, type AnyColumn } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AnyActor, StaffActor } from "./actor";
import { forbidden, notFound } from "./errors";

/**
 * The single place where role scope is applied. Every query for user-owned data
 * goes through one of these helpers:
 *   admin    → every account
 *   subadmin → accounts listed in subadmin_accounts
 *   user     → only their own
 *   system   → every account (worker jobs)
 */

/** A WHERE fragment restricting `userIdColumn` to the actor's scope (undefined = no restriction). */
export function scopeWhere(actor: AnyActor, userIdColumn: AnyColumn): SQL | undefined {
  if (actor.type === "system") return undefined;
  if (actor.type === "user") return eq(userIdColumn, actor.id);
  if (actor.role === "admin") return undefined;
  return inArray(
    userIdColumn,
    db
      .select({ id: schema.subadminAccounts.userId })
      .from(schema.subadminAccounts)
      .where(eq(schema.subadminAccounts.staffId, actor.id)),
  );
}

/** Combine the scope with other conditions. */
export function scoped(actor: AnyActor, userIdColumn: AnyColumn, ...conds: (SQL | undefined)[]) {
  return and(scopeWhere(actor, userIdColumn), ...conds);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

export async function canAccessUser(actor: AnyActor, userId: string): Promise<boolean> {
  if (!isUuid(userId)) return false;
  if (actor.type === "system") return true;
  if (actor.type === "user") return actor.id === userId;
  if (actor.role === "admin") return true;
  const row = await db.query.subadminAccounts.findFirst({
    where: and(eq(schema.subadminAccounts.staffId, actor.id), eq(schema.subadminAccounts.userId, userId)),
  });
  return !!row;
}

export async function assertUserAccess(actor: AnyActor, userId: string) {
  if (!(await canAccessUser(actor, userId))) throw notFound();
}

/** Load a user-owned row by id and check scope in one step. */
export async function loadScoped<T extends { userId: string | null }>(
  actor: AnyActor,
  load: () => Promise<T | undefined>,
): Promise<T> {
  const row = await load();
  if (!row || !row.userId || !(await canAccessUser(actor, row.userId))) throw notFound();
  return row;
}

export function requireStaff(actor: AnyActor): asserts actor is StaffActor {
  if (actor.type !== "staff") throw forbidden();
}

export function requireAdmin(actor: AnyActor): asserts actor is StaffActor {
  if (actor.type !== "staff" || actor.role !== "admin") throw forbidden();
}

export function requireInvitePermission(actor: AnyActor): asserts actor is StaffActor {
  requireStaff(actor);
  if (actor.role === "subadmin" && !actor.canInvite) throw forbidden("You are not allowed to invite users");
}
