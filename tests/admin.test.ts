import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setOffsetMs } from "@/server/clock";
import { registerUser } from "@/server/auth";
import { deleteUser, suspendUser } from "@/server/services/accounts";
import { CRITICAL_DAYS, QUIET_DAYS, dashboardTotals, postingHealth } from "@/server/services/dashboard";
import {
  createOrganization,
  deleteOrganization,
  organizationContext,
  selectableOrganizations,
  updateOrganization,
} from "@/server/services/organizations";
import { call, resetDb, seedPeople } from "./helpers";

let admin: Awaited<ReturnType<typeof seedPeople>>["admin"];
let sub: Awaited<ReturnType<typeof seedPeople>>["sub"];
let inScope: Awaited<ReturnType<typeof seedPeople>>["inScope"];

beforeEach(async () => {
  await resetDb();
  const people = await seedPeople();
  admin = people.admin;
  sub = people.sub;
  inScope = people.inScope;
  // These tests measure ages in days against the real clock, so no time travel.
  await setOffsetMs(0);
});

const asAdmin = { type: "staff", id: "", role: "admin", name: "Admin", email: "admin@test.dev", canInvite: true } as const;
const actorAdmin = () => ({ ...asAdmin, id: admin.id });
const actorSub = () => ({ type: "staff", id: sub.id, role: "subadmin", name: "Sub", email: "sub@test.dev", canInvite: true }) as const;

describe("organizations", () => {
  it("only an admin may create one, and only active ones are offered at sign-up", async () => {
    await expect(createOrganization(actorSub(), { name: "Mediwira", context: "" })).rejects.toThrow();

    const org = await createOrganization(actorAdmin(), { name: "Mediwira", context: "Never name a patient." });
    expect((await selectableOrganizations()).map((o) => o.name)).toEqual(["Mediwira"]);

    await updateOrganization(actorAdmin(), org.id, { active: false });
    expect(await selectableOrganizations()).toEqual([]);
  });

  it("refuses a duplicate name", async () => {
    await createOrganization(actorAdmin(), { name: "Mediwira", context: "" });
    await expect(createOrganization(actorAdmin(), { name: "Mediwira", context: "" })).rejects.toThrow();
  });

  it("sign-up links the account and inherits the brief", async () => {
    const org = await createOrganization(actorAdmin(), { name: "Mediwira", context: "  Never name a patient.  " });
    const u = await registerUser({
      name: "Dr New",
      email: "new@test.dev",
      password: "a-very-strong-password",
      organizationId: org.id,
      company: "",
      phone: "+60119000001",
    });
    expect(u.organizationId).toBe(org.id);
    // The name is copied so drafts read the same even if the link is cut later.
    expect(u.org).toBe("Mediwira");
    expect(await organizationContext(u.id)).toBe("Never name a patient.");
  });

  it("refuses a sign-up pointing at an organization that is closed or unknown", async () => {
    const org = await createOrganization(actorAdmin(), { name: "Closed Co", context: "" });
    await updateOrganization(actorAdmin(), org.id, { active: false });
    const signup = (organizationId: string) =>
      registerUser({ name: "Dr New", email: `n${organizationId.slice(0, 8)}@test.dev`, password: "a-very-strong-password", organizationId, company: "", phone: "+60119000002" });
    await expect(signup(org.id)).rejects.toThrow();
    await expect(signup("11111111-1111-1111-1111-111111111111")).rejects.toThrow();
  });

  it("a rename follows through to its people, and deleting it leaves them standing", async () => {
    const org = await createOrganization(actorAdmin(), { name: "Old Name", context: "House rules." });
    await db.update(schema.users).set({ organizationId: org.id, org: "Old Name" }).where(eq(schema.users.id, inScope.id));

    await updateOrganization(actorAdmin(), org.id, { name: "New Name" });
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, inScope.id) }))!.org).toBe("New Name");

    await deleteOrganization(actorAdmin(), org.id);
    const after = (await db.query.users.findFirst({ where: eq(schema.users.id, inScope.id) }))!;
    expect(after.id).toBe(inScope.id);
    expect(after.organizationId).toBeNull();
    expect(await organizationContext(inScope.id)).toBe("");
  });
});

describe("suspending and deleting accounts", () => {
  it("suspending stops the account and resuming restores it", async () => {
    await db.update(schema.users).set({ status: "active" }).where(eq(schema.users.id, inScope.id));
    await suspendUser(actorSub(), inScope.id, true);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, inScope.id) }))!.status).toBe("paused");
    await suspendUser(actorSub(), inScope.id, false);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, inScope.id) }))!.status).toBe("active");
  });

  it("will not suspend an account that is still setting up", async () => {
    await expect(suspendUser(actorAdmin(), inScope.id, true)).rejects.toThrow();
  });

  it("deleting takes the account's data with it but leaves the audit trail", async () => {
    await db.insert(schema.personas).values({ userId: inScope.id, version: 1, json: {}, status: "active", createdBy: "system:test" });
    const publishAt = new Date(Date.now() + 10 * 86_400_000);
    await db.insert(schema.slots).values({ userId: inScope.id, publishAt, approvalDeadline: publishAt });
    await db.insert(schema.posts).values({ userId: inScope.id, status: "pending_approval" });
    await db.insert(schema.waMessages).values({ userId: inScope.id, phoneE164: inScope.phoneE164, direction: "out", type: "text", body: "hi", status: "sent" });

    await deleteUser(actorAdmin(), inScope.id, inScope.email);

    expect(await db.query.users.findFirst({ where: eq(schema.users.id, inScope.id) })).toBeUndefined();
    for (const t of [schema.personas, schema.slots, schema.posts, schema.waMessages])
      expect(await db.select().from(t)).toEqual([]);
    const trail = await db.query.auditLog.findMany({ where: eq(schema.auditLog.userId, inScope.id) });
    expect(trail.map((a) => a.action)).toContain("user.delete");
  });

  it("refuses without the matching email, and refuses a sub-admin outright", async () => {
    await expect(deleteUser(actorAdmin(), inScope.id, "wrong@test.dev")).rejects.toThrow();
    await expect(deleteUser(actorSub(), inScope.id, inScope.email)).rejects.toThrow();
    expect(await db.query.users.findFirst({ where: eq(schema.users.id, inScope.id) })).toBeTruthy();
  });

  it("a suspended account cannot sign in", async () => {
    const { loginWithPassword } = await import("@/server/auth");
    await db
      .update(schema.users)
      .set({ status: "paused", passwordHash: (await import("@/server/crypto")).hashPassword("a-very-strong-password") })
      .where(eq(schema.users.id, inScope.id));
    await expect(loginWithPassword(inScope.email, "a-very-strong-password")).rejects.toThrow(/suspended/i);
  });
});

describe("posting health", () => {
  const live = async (userId: string, approvedAt: Date) =>
    db.update(schema.users).set({ status: "active", approvedAt }).where(eq(schema.users.id, userId));
  const posted = async (userId: string, publishAt: Date) =>
    db.insert(schema.posts).values({ userId, status: "approved", publishAt, approvedAt: publishAt });
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it("marks an account critical at 14 days and quiet at 7", async () => {
    await live(inScope.id, daysAgo(90));
    await posted(inScope.id, daysAgo(3));
    expect((await postingHealth(actorAdmin())).rows[0].health).toBe("healthy");

    await db.delete(schema.posts);
    await posted(inScope.id, daysAgo(QUIET_DAYS));
    expect((await postingHealth(actorAdmin())).rows[0].health).toBe("quiet");

    await db.delete(schema.posts);
    await posted(inScope.id, daysAgo(CRITICAL_DAYS));
    const row = (await postingHealth(actorAdmin())).rows[0];
    expect(row.health).toBe("critical");
    expect(row.daysSince).toBe(CRITICAL_DAYS);
  });

  it("does not count a post that has not gone out yet", async () => {
    await live(inScope.id, daysAgo(90));
    await posted(inScope.id, daysAgo(20));
    // Approved for next week: real, but it is not a post yet.
    await db.insert(schema.posts).values({ userId: inScope.id, status: "approved", publishAt: new Date(Date.now() + 5 * 86_400_000), approvedAt: new Date() });
    const row = (await postingHealth(actorAdmin())).rows[0];
    expect(row.health).toBe("critical");
    expect(row.daysSince).toBe(20);
  });

  it("a brand-new account is not critical before it has had a chance", async () => {
    await live(inScope.id, daysAgo(2));
    expect((await postingHealth(actorAdmin())).rows[0].health).toBe("new");
    await live(inScope.id, daysAgo(CRITICAL_DAYS + 1));
    expect((await postingHealth(actorAdmin())).rows[0].health).toBe("critical");
  });

  it("worst first, and only inside the caller's scope", async () => {
    const { outScope } = { outScope: (await db.query.users.findFirst({ where: eq(schema.users.email, "outscope@test.dev") }))! };
    await live(inScope.id, daysAgo(60));
    await live(outScope.id, daysAgo(60));
    await posted(inScope.id, daysAgo(30));
    await posted(outScope.id, daysAgo(1));

    const all = await postingHealth(actorAdmin());
    expect(all.rows.map((r) => r.health)).toEqual(["critical", "healthy"]);

    // The sub-admin only has inScope assigned.
    const mine = await postingHealth(actorSub());
    expect(mine.rows.map((r) => r.id)).toEqual([inScope.id]);
  });

  it("counts the last eight weeks of published posts", async () => {
    await live(inScope.id, daysAgo(90));
    await posted(inScope.id, daysAgo(2));
    await posted(inScope.id, daysAgo(4));
    await posted(inScope.id, daysAgo(40));
    const { weeks } = await postingHealth(actorAdmin());
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)!.count).toBe(2);
    expect(weeks.reduce((n, w) => n + w.count, 0)).toBe(3);
  });

  it("totals separate live, suspended and still-setting-up accounts", async () => {
    await live(inScope.id, daysAgo(10));
    const t = await dashboardTotals(actorAdmin());
    expect(t.live).toBe(1);
    expect(t.settingUp).toBe(1); // outScope is still onboarding
    await suspendUser(actorAdmin(), inScope.id, true);
    expect((await dashboardTotals(actorAdmin())).suspended).toBe(1);
  });
});

describe("the organisation brief reaches the model", () => {
  it("is in the draft, review and revision prompts for a member, and absent for everyone else", async () => {
    const ai = await import("@/server/ai");
    const { loadPrompt, fill } = await import("@/server/ai/prompts");
    for (const name of ["draft-generation", "draft-review", "draft-revision"]) {
      const p = loadPrompt(name);
      expect(p.version).toBe(`${name}.v2`);
      expect(p.text).toContain("{{org_context}}");
      expect(fill(p.text, { org_context: "Never name a client." })).toContain("Never name a client.");
    }
    expect(typeof ai.generateDraft).toBe("function");

    const org = await createOrganization(actorAdmin(), { name: "Mediwira", context: "Never name a patient." });
    await db.update(schema.users).set({ organizationId: org.id }).where(eq(schema.users.id, inScope.id));
    expect(await organizationContext(inScope.id)).toBe("Never name a patient.");
    const outScope = (await db.query.users.findFirst({ where: eq(schema.users.email, "outscope@test.dev") }))!;
    expect(await organizationContext(outScope.id)).toBe("");
  });
});

describe("the sign-up form's organization list", () => {
  it("is public, so the register page can read it before anyone has an account", async () => {
    await createOrganization(actorAdmin(), { name: "Mediwira", context: "secret brief, never exposed" });
    const route = await import("@/app/api/organizations/route");
    const r = await call(route.GET, { method: "GET" });
    expect(r.status).toBe(200);
    expect(r.json.organizations).toEqual([{ id: expect.any(String), name: "Mediwira" }]);
    // The brief is the employer's, not the public's.
    expect(JSON.stringify(r.json)).not.toContain("secret brief");
  });
});
