import { beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { NextRequest } from "next/server";
import { db, schema } from "@/db";
import { setOffsetMs } from "@/server/clock";
import * as mockAi from "@/server/ai/mock";
import { SYSTEM } from "@/server/actor";
import { saveCadence, generateSlots } from "@/server/services/cadence";
import { board, latestPendingPost } from "@/server/services/posts";
import { schedulerTick } from "@/server/scheduler";
import { processDueBundles } from "@/server/whatsapp/inbound";
import { setGateway } from "@/server/whatsapp";
import { MockGateway } from "@/server/whatsapp/mock";
import { sweepOutbox } from "@/server/whatsapp/outbox";
import { redis } from "@/server/queue";
import { call, cookieFor, resetDb, seedPeople } from "./helpers";
import * as phoneRoute from "@/app/api/dev/phone/route";
import * as previewRoute from "@/app/api/preview/[token]/route";
import * as postRoute from "@/app/api/posts/[postId]/route";

const KL = "Asia/Kuala_Lumpur";
const PHONE = "+60110000001";

const travelTo = (iso: string) => setOffsetMs(DateTime.fromISO(iso, { zone: KL }).toMillis() - Date.now());
const phone = async (text: string) => {
  await phoneRoute.POST(new NextRequest("http://x/api/dev/phone", { method: "POST", body: JSON.stringify({ from: PHONE, text }), headers: { "content-type": "application/json" } }));
};
const say = async (text: string) => {
  await phone(text);
  await phone("done");
};
const outs = async (userId: string) =>
  (await db.query.waMessages.findMany({ where: and(eq(schema.waMessages.userId, userId), eq(schema.waMessages.direction, "out")), orderBy: (m, { asc }) => asc(m.createdAt) })).map((m) => m.body ?? "");
const tokenFrom = (text: string) => text.match(/\/p\/([\w-]+)/)?.[1];
const firstSlot = async (userId: string) => (await db.query.slots.findFirst({ where: eq(schema.slots.userId, userId), orderBy: (s, { asc }) => asc(s.publishAt) }))!;
const post = async (id: string) => (await db.query.posts.findFirst({ where: eq(schema.posts.id, id) }))!;

let userId: string;
let people: Awaited<ReturnType<typeof seedPeople>>;

/** Active, verified user (in the sub-admin's scope) with a Tue/Thu 09:00 cadence. */
beforeEach(async () => {
  await resetDb();
  await redis().flushdb();
  MockGateway.connected = true;
  setGateway(new MockGateway());
  await travelTo("2026-10-05T10:00");
  people = await seedPeople();
  userId = people.inScope.id;
  const persona = mockAi.persona({ profile: { display_name: "Dr Nanda", languages: ["en"] }, answers: [{ key: "known_for", question: "", answer: "Preventive cardiology, team culture" }], prefs: {}, samples: [], golden: [] });
  await db.update(schema.users).set({ status: "active", whatsappVerifiedAt: new Date(), timezone: KL, displayName: "Dr Nanda" }).where(eq(schema.users.id, userId));
  await db.insert(schema.personas).values({ userId, version: 1, json: persona, status: "active", createdBy: "system:test" });
  await saveCadence(SYSTEM, userId, { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] });
  await generateSlots(userId);
});

describe("drafts on schedule", () => {
  it("T−7d topic prompt; picking a suggestion drafts it, reviews it and sends a preview link", async () => {
    const slot = await firstSlot(userId); // Tue 13 Oct 09:00
    await travelTo("2026-10-06T09:01");
    expect((await schedulerTick()).prompts).toBeGreaterThanOrEqual(1);
    const prompt = (await outs(userId)).find((m) => m.startsWith("Your post for Tue 13 Oct"))!;
    expect(prompt).toMatch(/1\. .+\n2\. /);

    await say("2");
    const p = await latestPendingPost(userId);
    expect(p?.slotId).toBe(slot.id);
    expect(p?.suggestedTopic).toBe(false);
    const v = (await db.query.postVersions.findFirst({ where: eq(schema.postVersions.postId, p!.id) }))!;
    expect(v.promptVersion).toBe("draft-generation.v1");
    expect(v.personaVersion).toBe(1);
    const link = (await outs(userId)).at(-1)!;
    expect(link).toMatch(/^Here's your draft for Tue 13 Oct, 9:00am/);
    expect(link).toMatch(/I need your approval by Sun 11 Oct, 9:00am/);
    expect(tokenFrom(link)).toBeTruthy();
    // generation and review both logged
    const kinds = (await db.query.aiGenerations.findMany({ where: eq(schema.aiGenerations.userId, userId) })).map((g) => g.kind);
    // a numbered pick needs no classification call
    expect(kinds).toEqual(expect.arrayContaining(["draft_generation", "review_pass"]));
  });

  it("T−5d with no input drafts a suggested topic", async () => {
    await travelTo("2026-10-08T09:01");
    const r = await schedulerTick();
    expect(r.autoDrafts).toBeGreaterThanOrEqual(1);
    const p = (await post((await firstSlot(userId)).postId!))!;
    expect(p.suggestedTopic).toBe(true);
    expect(p.status).toBe("pending_approval");
    expect(await outs(userId)).toContainEqual(expect.stringMatching(/^Here's your draft for Tue 13 Oct, 9:00am \(I picked a topic from your pillars\)/));
    // idempotent
    expect((await schedulerTick()).autoDrafts).toBe(0);
  });

  it("a draft that fails review twice goes to staff, not the user", async () => {
    await travelTo("2026-10-06T10:00");
    await say("Our new screening programme is a game-changer for rural patients in Perak and beyond, truly");
    const p = (await db.query.posts.findFirst({ where: eq(schema.posts.userId, userId) }))!;
    expect(p.flaggedForStaff).toBe(true);
    expect(p.reviewIssues).toEqual(expect.arrayContaining([expect.stringMatching(/game-changer/)]));
    expect((await outs(userId)).some((m) => m.includes("/p/"))).toBe(false);
    expect(await db.query.emails.findFirst({ where: eq(schema.emails.to, people.sub.email) })).toBeTruthy(); // assigned sub-admin
    // the user can't approve it until staff release it
    expect((await call(postRoute.POST, { cookie: await cookieFor("user", userId), params: { postId: p.id }, body: { action: "approve" } })).status).toBe(409);
    const sub = await cookieFor("staff", people.sub.id);
    const fixed = mockAi.draft({ persona: mockAi.persona({ profile: { display_name: "x", languages: [] }, answers: [], prefs: {}, samples: [], golden: [] }), input: "Our new screening programme is helping rural patients in Perak", images: [] }).text;
    const edit = await call(postRoute.POST, { cookie: sub, params: { postId: p.id }, body: { action: "edit", text: fixed } });
    expect(edit.json).toEqual(expect.objectContaining({ ok: true }));
    expect((await call(postRoute.POST, { cookie: sub, params: { postId: p.id }, body: { action: "release" } })).status).toBe(200);
    expect((await outs(userId)).at(-1)).toMatch(/\/p\//);
  });
});

describe("approval", () => {
  async function pendingWithLink() {
    await travelTo("2026-10-06T10:00");
    await say("We ran a free heart screening day in Kampung Baru on Saturday, 140 people checked");
    const p = (await latestPendingPost(userId))!;
    return { p, token: tokenFrom((await outs(userId)).at(-1)!)! };
  }

  it("preview link: approve → approved, confirmed, logged, link stops working", async () => {
    const { p, token } = await pendingWithLink();
    const view = await call(previewRoute.GET, { params: { token } });
    expect(view.status).toBe(200);
    expect(view.json.user.displayName).toBe("Dr Nanda");
    expect(view.json.slot.approvalDeadline).toBeTruthy();

    expect((await call(previewRoute.POST, { params: { token }, body: { action: "approve" } })).status).toBe(200);
    const after = await post(p.id);
    expect(after.status).toBe("approved");
    expect(after.publishStatus).toBe("logged"); // NoopPublisher
    expect((await firstSlot(userId)).status).toBe("approved");
    expect((await outs(userId)).at(-1)).toBe("Approved. It's scheduled for Tue 13 Oct, 9:00am.");
    expect(await db.query.goldenCandidates.findFirst({ where: eq(schema.goldenCandidates.postId, p.id) })).toBeTruthy();
    expect(await db.query.auditLog.findFirst({ where: and(eq(schema.auditLog.action, "post.approve"), eq(schema.auditLog.entityId, p.id)) })).toBeTruthy();
    expect((await call(previewRoute.GET, { params: { token } })).status).toBe(404);
  });

  it("preview link: request changes → revised version and a new link; inline edit adds a version", async () => {
    const { p, token } = await pendingWithLink();
    expect((await call(previewRoute.POST, { params: { token }, body: { action: "changes", feedback: "Make it shorter and drop the hashtags" } })).status).toBe(200);
    const versions = await db.query.postVersions.findMany({ where: eq(schema.postVersions.postId, p.id) });
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.number === 2)?.feedback).toMatch(/shorter/);
    expect((await post(p.id)).status).toBe("pending_approval");
    expect((await outs(userId)).at(-1)).toMatch(/^Updated draft for Tue 13 Oct/);

    expect((await call(previewRoute.POST, { params: { token }, body: { action: "edit", text: "My own words, thank you." } })).status).toBe(200);
    const view = await call(previewRoute.GET, { params: { token } });
    expect(view.json.versions[0].text).toBe("My own words, thank you.");
    expect(view.json.versions).toHaveLength(3);
    // back to an earlier version
    expect((await call(previewRoute.POST, { params: { token }, body: { action: "revert", versionId: view.json.versions[2].id } })).status).toBe(200);
    expect((await call(previewRoute.GET, { params: { token } })).json.versions[0].feedback).toBe("Restored version 1");
  });

  it('WhatsApp: "approve" approves the latest draft; anything else is feedback', async () => {
    const { p } = await pendingWithLink();
    await phone("can you make it less formal");
    await processDueBundles(); // not yet: still within the quiet period
    await phone("done");
    expect((await db.query.postVersions.findMany({ where: eq(schema.postVersions.postId, p.id) })).length).toBe(2);
    await phone("approve"); // a lone approval skips the wait
    expect((await post(p.id)).status).toBe("approved");
  });

  it("move to another slot", async () => {
    const { p, token } = await pendingWithLink();
    const view = await call(previewRoute.GET, { params: { token } });
    const target = view.json.freeSlots[0];
    expect((await call(previewRoute.POST, { params: { token }, body: { action: "move", slotId: target.id } })).status).toBe(200);
    expect((await post(p.id)).slotId).toBe(target.id);
    expect((await firstSlot(userId)).status).toBe("awaiting_input");
  });

  it("staff approval waits for the user unless the account says it's final", async () => {
    const { p } = await pendingWithLink();
    const sub = await cookieFor("staff", people.sub.id);
    let r = await call(postRoute.POST, { cookie: sub, params: { postId: p.id }, body: { action: "approve" } });
    expect(r.json.result.final).toBe(false);
    expect((await post(p.id)).status).toBe("pending_approval");
    expect((await post(p.id)).staffApprovedBy).toBe(people.sub.id);

    await db.update(schema.users).set({ staffApprovalIsFinal: true }).where(eq(schema.users.id, userId));
    r = await call(postRoute.POST, { cookie: sub, params: { postId: p.id }, body: { action: "approve" } });
    expect(r.json.result.final).toBe(true);
    expect((await post(p.id)).approvedBy).toBe(`staff:${people.sub.id}`);
    expect((await outs(userId)).at(-1)).toMatch(/Sub approved it for you\./);
  });

  it("refuses approval after the deadline, except an admin override", async () => {
    const { p } = await pendingWithLink();
    await travelTo("2026-10-11T09:30"); // past Sun 11 09:00 deadline, before the tick marks it missed
    const user = await cookieFor("user", userId);
    expect((await call(postRoute.POST, { cookie: user, params: { postId: p.id }, body: { action: "approve" } })).status).toBe(409);
    await db.update(schema.users).set({ staffApprovalIsFinal: true }).where(eq(schema.users.id, userId));
    const admin = await cookieFor("staff", people.admin.id);
    expect((await call(postRoute.POST, { cookie: admin, params: { postId: p.id }, body: { action: "approve", override: true } })).status).toBe(200);
    expect(await db.query.auditLog.findFirst({ where: eq(schema.auditLog.action, "post.approve_override") })).toBeTruthy();
  });

  it("preview links expire after 7 days", async () => {
    const { token } = await pendingWithLink();
    await travelTo("2026-10-13T10:01");
    expect((await call(previewRoute.GET, { params: { token } })).status).toBe(404);
  });
});

describe("reminders and deadlines", () => {
  it("reminds at T−72h and T−56h (quiet hours respected), alerts staff, then marks missed at T−48h", async () => {
    await travelTo("2026-10-06T10:00");
    await say("We ran a free heart screening day in Kampung Baru on Saturday, 140 people checked");
    const p = (await latestPendingPost(userId))!;
    const count = async (re: RegExp) => (await outs(userId)).filter((m) => re.test(m)).length;

    await travelTo("2026-10-10T08:59");
    await schedulerTick();
    expect(await count(/^Reminder:/)).toBe(0);
    await travelTo("2026-10-10T09:00"); // T−72h
    await schedulerTick();
    expect(await count(/^Reminder:/)).toBe(1);
    await schedulerTick();
    expect(await count(/^Reminder:/)).toBe(1); // once

    // T−56h is Sun 01:00 — quiet hours — so the second reminder waits for 08:00
    await travelTo("2026-10-11T01:30");
    await schedulerTick();
    expect(await count(/^Last reminder:/)).toBe(0);
    await travelTo("2026-10-11T08:00");
    await schedulerTick();
    expect(await count(/^Last reminder:/)).toBe(1);
    expect(await db.query.emails.findFirst({ where: eq(schema.emails.to, people.sub.email) })).toBeTruthy();

    // at-risk on the board for the sub-admin
    const items = await board({ type: "staff", id: people.sub.id, role: "subadmin", name: "Sub", email: people.sub.email, canInvite: true });
    expect(items.find((i) => i.post?.id === p.id)?.atRisk).toBe(true);

    await travelTo("2026-10-11T09:00"); // T−48h
    await schedulerTick();
    expect((await post(p.id)).status).toBe("missed");
    expect((await firstSlot(userId)).status).toBe("missed");
    expect((await outs(userId)).at(-1)).toMatch(/won't go out unless you reschedule/);
  });

  it("night-time reminders are held until 8am", async () => {
    await saveCadence(SYSTEM, userId, { postsPerWeek: 2, weekdays: [2, 4], times: ["23:00", "23:00"] });
    await travelTo("2026-10-06T10:00");
    await say("We ran a free heart screening day in Kampung Baru on Saturday, 140 people checked");
    // first slot Tue 13 23:00 → T−72h is Sat 10 23:00 (quiet) → 08:00 Sun 11
    await travelTo("2026-10-10T23:05");
    await schedulerTick();
    expect((await outs(userId)).filter((m) => m.startsWith("Reminder:"))).toHaveLength(0);
    await travelTo("2026-10-11T08:00");
    await schedulerTick();
    await sweepOutbox();
    expect((await outs(userId)).filter((m) => m.startsWith("Reminder:"))).toHaveLength(1);
  });
});

describe("learning from edits", () => {
  it("after 5 edits, refreshes the persona and tells the user in one line", async () => {
    await travelTo("2026-10-06T10:00");
    await say("We ran a free heart screening day in Kampung Baru on Saturday, 140 people checked");
    const p = (await latestPendingPost(userId))!;
    const cookie = await cookieFor("user", userId);
    // each edit trims the post further
    for (const n of [200, 150, 100, 70, 40]) await call(postRoute.POST, { cookie, params: { postId: p.id }, body: { action: "edit", text: "x".repeat(n) } });
    const personas = await db.query.personas.findMany({ where: eq(schema.personas.userId, userId), orderBy: desc(schema.personas.version) });
    expect(personas[0].version).toBe(2);
    expect(personas[0].createdBy).toBe("system:refresh");
    expect((personas[0].json as { voice: { length: string } }).voice.length).toBe("short");
    expect((await outs(userId)).at(-1)).toMatch(/I've noticed you prefer shorter posts/);
    expect((await db.query.editPairs.findMany({ where: eq(schema.editPairs.userId, userId) })).every((e) => e.consumedInVersion === 2)).toBe(true);
  });
});
