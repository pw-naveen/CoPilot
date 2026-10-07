import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "@/db";
import { setOffsetMs } from "@/server/clock";
import { SYSTEM } from "@/server/actor";
import { createExtraSlot, generateSlots, listSlots, saveCadence } from "@/server/services/cadence";
import { monthKey } from "@/server/schedule";
import { call, cookieFor, resetDb, seedPeople } from "./helpers";
import * as cadenceRoute from "@/app/api/users/[userId]/cadence/route";
import * as previewRoute from "@/app/api/users/[userId]/cadence/preview/route";

const KL = "Asia/Kuala_Lumpur";

/** Pin the scheduler clock to a known instant. */
async function travelTo(isoLocal: string, tz = KL) {
  await setOffsetMs(DateTime.fromISO(isoLocal, { zone: tz }).toMillis() - Date.now());
}

describe("cadence and calendar", () => {
  let userId: string;
  beforeEach(async () => {
    await resetDb();
    const { inScope } = await seedPeople();
    userId = inScope.id;
    await db.update(schema.users).set({ status: "active", whatsappVerifiedAt: new Date(), timezone: KL }).where(eq(schema.users.id, userId));
    await travelTo("2026-10-05T10:00"); // Monday
  });

  it("previews the next 4 weeks with deadlines 48h ahead", async () => {
    const cookie = await cookieFor("user", userId);
    const r = await call(previewRoute.POST, { cookie, params: { userId }, body: { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] } });
    expect(r.status).toBe(200);
    expect(r.json.preview.length).toBe(8);
    for (const s of r.json.preview) expect(new Date(s.publishAt).getTime() - new Date(s.approvalDeadline).getTime()).toBe(48 * 3600_000);
    // first slot is at least 5 days out so its timeline can run
    expect(DateTime.fromISO(r.json.preview[0].publishAt, { zone: KL }).toISODate()).toBe("2026-10-13");
  });

  it("rejects cadences other than 2 or 4 a week", async () => {
    const cookie = await cookieFor("user", userId);
    const r = await call(cadenceRoute.PUT, { method: "PUT", cookie, params: { userId }, body: { postsPerWeek: 3, weekdays: [1, 2, 3], times: ["09:00", "09:00", "09:00"] } });
    expect(r.status).toBe(400);
  });

  it("generates slots 6 weeks ahead for active users and is idempotent", async () => {
    await saveCadence(SYSTEM, userId, { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "14:00"] });
    const slots = await db.query.slots.findMany({ where: eq(schema.slots.userId, userId) });
    expect(slots.length).toBeGreaterThanOrEqual(10);
    const now = DateTime.fromISO("2026-10-05T10:00", { zone: KL }).toMillis();
    const last = Math.max(...slots.map((s) => s.publishAt.getTime()));
    expect(last).toBeLessThanOrEqual(now + 6 * 7 * 86_400_000);
    expect(last).toBeGreaterThan(now + 5 * 7 * 86_400_000);
    for (const s of slots) expect(s.publishAt.getTime() - s.approvalDeadline.getTime()).toBe(48 * 3600_000);
    expect(await generateSlots(userId)).toHaveLength(0);
  });

  it("never exceeds 20 a month, extras included", async () => {
    await saveCadence(SYSTEM, userId, { postsPerWeek: 4, weekdays: [1, 2, 3, 4], times: ["09:00", "09:00", "09:00", "09:00"] });
    // fill up December with extras until the cap bites
    await travelTo("2026-11-20T10:00");
    await generateSlots(userId);
    let added = 0;
    for (let d = 1; d <= 31; d++) {
      const date = `2026-12-${String(d).padStart(2, "0")}`;
      try {
        await createExtraSlot(userId, date);
        added++;
      } catch (e) {
        expect(String(e)).toMatch(/20 posts/);
      }
    }
    expect(added).toBeGreaterThan(0);
    const dec = (await db.query.slots.findMany({ where: eq(schema.slots.userId, userId) })).filter((s) => monthKey(s.publishAt, KL) === "2026-12");
    expect(dec.length).toBe(20);
  });

  it("a cadence change regenerates only future, unfilled slots", async () => {
    await saveCadence(SYSTEM, userId, { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] });
    const before = await db.query.slots.findMany({ where: eq(schema.slots.userId, userId), orderBy: (s, { asc }) => asc(s.publishAt) });
    // one slot has a draft in progress
    const [post] = await db.insert(schema.posts).values({ userId, slotId: before[0].id, status: "drafting" }).returning();
    await db.update(schema.slots).set({ status: "drafting", postId: post.id }).where(eq(schema.slots.id, before[0].id));

    await saveCadence(SYSTEM, userId, { postsPerWeek: 2, weekdays: [1, 5], times: ["08:00", "08:00"] });
    const after = await db.query.slots.findMany({ where: eq(schema.slots.userId, userId) });
    expect(after.find((s) => s.id === before[0].id)).toBeTruthy(); // kept
    const others = after.filter((s) => s.id !== before[0].id);
    for (const s of others) expect([1, 5]).toContain(DateTime.fromJSDate(s.publishAt, { zone: KL }).weekday);
    // history kept
    expect((await db.query.cadences.findMany({ where: eq(schema.cadences.userId, userId) })).length).toBe(2);
  });

  it("extra slots respect the 48-hour rule", async () => {
    await saveCadence(SYSTEM, userId, { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] });
    await expect(createExtraSlot(userId, "2026-10-06")).rejects.toThrow(/48 hours/);
    const ok = await createExtraSlot(userId, "2026-10-09");
    expect(ok.isExtra).toBe(true);
  });

  it("lists slots with deadlines through the scoped API", async () => {
    await saveCadence(SYSTEM, userId, { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] });
    const slots = await listSlots(SYSTEM, userId);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].approvalDeadline).toBeInstanceOf(Date);
    const missing = await db.query.slots.findMany({ where: and(eq(schema.slots.userId, userId), eq(schema.slots.status, "missed")) });
    expect(missing).toHaveLength(0);
  });
});
