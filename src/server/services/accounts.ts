import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { actorRef, type AnyActor, type StaffActor } from "../actor";
import { audit } from "../audit";
import { sendInvite } from "../auth";
import { getSetting } from "../config";
import { conflict, notFound } from "../errors";
import { assertUserAccess, requireAdmin, requireInvitePermission, requireStaff, scopeWhere } from "../scope";

export const e164 = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +60123456789");

export const inviteUserInput = z.object({
  name: z.string().trim().min(1),
  title: z.string().trim().optional(),
  email: z.string().trim().toLowerCase().email(),
  phone: e164,
});

export async function inviteUser(actor: AnyActor, input: z.infer<typeof inviteUserInput>) {
  requireInvitePermission(actor);
  const exists =
    (await db.query.users.findFirst({ where: eq(schema.users.email, input.email) })) ||
    (await db.query.staff.findFirst({ where: eq(schema.staff.email, input.email) }));
  if (exists) throw conflict("That email is already in use");
  if (await db.query.users.findFirst({ where: eq(schema.users.phoneE164, input.phone) }))
    throw conflict("That WhatsApp number is already in use");

  const tz = (await getSetting("defaults.timezone")) ?? "Asia/Kuala_Lumpur";
  const user = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        name: input.name,
        displayName: input.name,
        title: input.title || null,
        email: input.email,
        phoneE164: input.phone,
        timezone: tz,
        invitedBy: actor.id,
      })
      .returning();
    // A sub-admin's invitee lands in their own scope.
    if (actor.role === "subadmin") await tx.insert(schema.subadminAccounts).values({ staffId: actor.id, userId: u.id });
    await audit(actor, { action: "user.invite", entity: "user", entityId: u.id, userId: u.id, after: input }, tx);
    return u;
  });
  await sendInvite({ type: "user", id: user.id, email: user.email, name: user.displayName }, actor.name);
  return user;
}

export const inviteStaffInput = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  canInvite: z.boolean().default(false),
});

export async function inviteSubadmin(actor: AnyActor, input: z.infer<typeof inviteStaffInput>) {
  requireAdmin(actor);
  const exists =
    (await db.query.users.findFirst({ where: eq(schema.users.email, input.email) })) ||
    (await db.query.staff.findFirst({ where: eq(schema.staff.email, input.email) }));
  if (exists) throw conflict("That email is already in use");
  const [s] = await db
    .insert(schema.staff)
    .values({ name: input.name, email: input.email, role: "subadmin", canInvite: input.canInvite })
    .returning();
  await audit(actor, { action: "staff.invite", entity: "staff", entityId: s.id, after: input });
  await sendInvite({ type: "staff", id: s.id, email: s.email, name: s.name }, actor.name);
  return s;
}

export async function updateSubadmin(actor: AnyActor, staffId: string, patch: { canInvite?: boolean }) {
  requireAdmin(actor);
  const before = await db.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
  if (!before || before.role !== "subadmin") throw notFound();
  const [after] = await db.update(schema.staff).set(patch).where(eq(schema.staff.id, staffId)).returning();
  await audit(actor, { action: "staff.update", entity: "staff", entityId: staffId, before: { canInvite: before.canInvite }, after: patch });
  return after;
}

export async function listStaff(actor: AnyActor) {
  requireAdmin(actor);
  const rows = await db.query.staff.findMany({ orderBy: asc(schema.staff.name) });
  const links = await db.select().from(schema.subadminAccounts);
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    role: s.role,
    canInvite: s.canInvite,
    totp: !!s.totpSecret,
    userIds: links.filter((l) => l.staffId === s.id).map((l) => l.userId),
  }));
}

export async function setSubadminAccounts(actor: AnyActor, staffId: string, userIds: string[]) {
  requireAdmin(actor);
  const s = await db.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
  if (!s || s.role !== "subadmin") throw notFound();
  if (userIds.length) {
    const found = await db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, userIds));
    if (found.length !== new Set(userIds).size) throw notFound("Unknown user");
  }
  const before = (await db.select().from(schema.subadminAccounts).where(eq(schema.subadminAccounts.staffId, staffId))).map(
    (r) => r.userId,
  );
  await db.transaction(async (tx) => {
    await tx.delete(schema.subadminAccounts).where(eq(schema.subadminAccounts.staffId, staffId));
    if (userIds.length)
      await tx.insert(schema.subadminAccounts).values([...new Set(userIds)].map((userId) => ({ staffId, userId })));
    await audit(actor, { action: "staff.assign", entity: "staff", entityId: staffId, before, after: userIds }, tx);
  });
}

export async function listUsers(actor: AnyActor) {
  requireStaff(actor);
  return db.query.users.findMany({
    where: scopeWhere(actor, schema.users.id),
    orderBy: asc(schema.users.displayName),
  });
}

export async function getUser(actor: AnyActor, userId: string) {
  await assertUserAccess(actor, userId);
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) throw notFound();
  return u;
}

export const accountSettingsInput = z.object({
  staffApprovalIsFinal: z.boolean().optional(),
  status: z.enum(["active", "paused"]).optional(),
});

/** Per-account switches staff control. */
export async function updateAccountSettings(
  actor: AnyActor,
  userId: string,
  patch: z.infer<typeof accountSettingsInput>,
) {
  requireStaff(actor);
  const before = await getUser(actor, userId);
  if (patch.status === "active" && !before.whatsappVerifiedAt)
    throw conflict("The account goes live after WhatsApp verification");
  const [after] = await db.update(schema.users).set(patch).where(eq(schema.users.id, userId)).returning();
  await audit(actor, {
    action: "user.settings",
    entity: "user",
    entityId: userId,
    userId,
    before: { staffApprovalIsFinal: before.staffApprovalIsFinal, status: before.status },
    after: patch,
  });
  return after;
}

export async function resendInvite(actor: StaffActor, userId: string) {
  requireInvitePermission(actor);
  const u = await getUser(actor, userId);
  await sendInvite({ type: "user", id: u.id, email: u.email, name: u.displayName }, actor.name);
  await audit(actor, { action: "user.reinvite", entity: "user", entityId: u.id, userId: u.id });
}

export async function listAudit(actor: AnyActor, opts: { userId?: string; limit?: number } = {}) {
  requireStaff(actor);
  if (opts.userId) await assertUserAccess(actor, opts.userId);
  const where =
    actor.role === "admin"
      ? opts.userId
        ? eq(schema.auditLog.userId, opts.userId)
        : undefined
      : and(scopeWhere(actor, schema.auditLog.userId), opts.userId ? eq(schema.auditLog.userId, opts.userId) : undefined);
  return db.query.auditLog.findMany({
    where,
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: Math.min(opts.limit ?? 200, 500),
  });
}

export { actorRef };
