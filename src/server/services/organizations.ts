import { asc, eq, ne, and } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { AnyActor } from "../actor";
import { audit } from "../audit";
import { conflict, notFound } from "../errors";
import { requireAdmin } from "../scope";

/**
 * Organizations group the people who work for the same company and carry one
 * standing brief for all of them.
 *
 * `context` is deliberately one free-text field rather than a schema of rules:
 * what a hospital group needs to say about compliance has no overlap with what
 * a law firm needs, and a structured form would fit neither. It is passed to the
 * model verbatim alongside the persona.
 */

export const ORG_CONTEXT_MAX = 8000;

export const organizationInput = z.object({
  name: z.string().trim().min(2).max(120),
  context: z.string().trim().max(ORG_CONTEXT_MAX).optional().default(""),
  active: z.boolean().optional(),
});

/** Organizations a new sign-up may choose. Public: the register form needs it. */
export async function selectableOrganizations() {
  const rows = await db.query.organizations.findMany({
    where: eq(schema.organizations.active, true),
    orderBy: asc(schema.organizations.name),
  });
  return rows.map((o) => ({ id: o.id, name: o.name }));
}

export async function listOrganizations(actor: AnyActor) {
  requireAdmin(actor);
  const [rows, users] = await Promise.all([
    db.query.organizations.findMany({ orderBy: asc(schema.organizations.name) }),
    db.select({ id: schema.users.id, organizationId: schema.users.organizationId }).from(schema.users),
  ]);
  return rows.map((o) => ({ ...o, members: users.filter((u) => u.organizationId === o.id).length }));
}

export async function createOrganization(actor: AnyActor, input: z.infer<typeof organizationInput>) {
  requireAdmin(actor);
  if (await db.query.organizations.findFirst({ where: eq(schema.organizations.name, input.name) }))
    throw conflict("An organization with that name already exists");
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: input.name, context: input.context ?? "", active: input.active ?? true })
    .returning();
  await audit(actor, { action: "org.create", entity: "organization", entityId: org.id, after: { name: org.name } });
  return org;
}

export async function updateOrganization(actor: AnyActor, orgId: string, input: Partial<z.infer<typeof organizationInput>>) {
  requireAdmin(actor);
  const before = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!before) throw notFound();
  if (input.name && input.name !== before.name) {
    const clash = await db.query.organizations.findFirst({
      where: and(eq(schema.organizations.name, input.name), ne(schema.organizations.id, orgId)),
    });
    if (clash) throw conflict("An organization with that name already exists");
  }
  const [after] = await db.update(schema.organizations).set(input).where(eq(schema.organizations.id, orgId)).returning();
  // Members display the organization's name on drafts, so a rename follows through.
  if (input.name && input.name !== before.name)
    await db.update(schema.users).set({ org: input.name }).where(eq(schema.users.organizationId, orgId));
  await audit(actor, {
    action: "org.update",
    entity: "organization",
    entityId: orgId,
    before: { name: before.name, active: before.active, contextLength: before.context.length },
    after: { name: after.name, active: after.active, contextLength: after.context.length },
  });
  return after;
}

/**
 * Deleting an organization leaves its people in place — their accounts, posts
 * and personas are their own. They simply stop inheriting the brief. To stop
 * new sign-ups choosing it without losing the link, set `active` false instead.
 */
export async function deleteOrganization(actor: AnyActor, orgId: string) {
  requireAdmin(actor);
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org) throw notFound();
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  await audit(actor, { action: "org.delete", entity: "organization", entityId: orgId, before: { name: org.name } });
}

/** The brief that applies to this user, or "" when they belong to no organization. */
export async function organizationContext(userId: string) {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u?.organizationId) return "";
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, u.organizationId) });
  return org?.context.trim() ?? "";
}
