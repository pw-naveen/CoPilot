import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { NextRequest } from "next/server";
import { db, schema } from "@/db";
import { getOffsetMs, setOffsetMs } from "@/server/clock";
import { setSetting } from "@/server/config";
import * as mockAi from "@/server/ai/mock";
import { saveCadence } from "@/server/services/cadence";
import { SYSTEM } from "@/server/actor";
import { MockGateway } from "@/server/whatsapp/mock";
import { EvolutionGateway } from "@/server/whatsapp/evolution";
import { cachedStatus, setGateway } from "@/server/whatsapp";
import { processDueBundles } from "@/server/whatsapp/inbound";
import { sweepOutbox } from "@/server/whatsapp/outbox";
import { redis } from "@/server/queue";
import { call, cookieFor, resetDb, seedPeople } from "./helpers";
import * as verifyRoute from "@/app/api/users/[userId]/whatsapp/verify/route";
import * as phoneRoute from "@/app/api/dev/phone/route";
import * as webhookRoute from "@/app/api/webhooks/evolution/route";

const KL = "Asia/Kuala_Lumpur";
const PHONE = "+60110000001";

async function travel(ms: number) {
  await setOffsetMs((await getOffsetMs()) + ms);
}
async function travelTo(isoLocal: string) {
  await setOffsetMs(DateTime.fromISO(isoLocal, { zone: KL }).toMillis() - Date.now());
}
const phone = (body: object) => phoneRoute.POST(new NextRequest("http://x/api/dev/phone", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const outbound = async (userId: string) =>
  db.query.waMessages.findMany({ where: and(eq(schema.waMessages.userId, userId), eq(schema.waMessages.direction, "out")), orderBy: (m, { asc }) => asc(m.createdAt) });
const lastOut = async (userId: string) => (await outbound(userId)).at(-1);

/** A user who has finished steps 2–6 and is waiting on WhatsApp verification. */
async function readyForWhatsApp() {
  const { inScope, admin } = await seedPeople();
  const persona = mockAi.persona({ profile: { display_name: "Dr In", languages: ["en"] }, answers: [], prefs: {}, samples: [], golden: [] });
  await db.update(schema.users).set({ onboardingStep: 7, timezone: KL, displayName: "Dr Nanda" }).where(eq(schema.users.id, inScope.id));
  await db.insert(schema.personas).values({ userId: inScope.id, version: 1, json: persona, status: "active", createdBy: "system:test" });
  await saveCadence(SYSTEM, inScope.id, { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] });
  return { user: inScope, admin };
}

async function verify(userId: string) {
  const cookie = await cookieFor("user", userId);
  expect((await call(verifyRoute.POST, { cookie, params: { userId }, body: {} })).status).toBe(200);
  const code = (await db.query.users.findFirst({ where: eq(schema.users.id, userId) }))!.whatsappVerifyCode!;
  await phone({ from: PHONE, text: `YES ${code}` });
}

beforeEach(async () => {
  await resetDb();
  MockGateway.connected = true;
  MockGateway.sent = [];
  setGateway(new MockGateway());
  await redis().flushdb();
  await travelTo("2026-10-05T10:00"); // Monday
});

describe("verification and welcome (MockGateway)", () => {
  it("verifies the number, goes live, generates slots and sends the welcome", async () => {
    const { user } = await readyForWhatsApp();
    const cookie = await cookieFor("user", user.id);
    const r = await call(verifyRoute.POST, { cookie, params: { userId: user.id }, body: {} });
    expect(r.status).toBe(200);
    const verifyMsg = await lastOut(user.id);
    expect(verifyMsg?.status).toBe("sent");
    expect(verifyMsg?.body).toMatch(/Reply YES \d{4}/);

    // a wrong reply gets a hint, not verification
    await phone({ from: PHONE, text: "hello?" });
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))!.whatsappVerifiedAt).toBeNull();

    const code = verifyMsg!.body!.match(/YES (\d{4})/)![1];
    await phone({ from: PHONE, text: `yes ${code}` });
    const u = (await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))!;
    expect(u.status).toBe("active");
    expect(u.whatsappVerifiedAt).toBeTruthy();
    expect((await db.query.slots.findMany({ where: eq(schema.slots.userId, user.id) })).length).toBeGreaterThan(8);

    const welcome = await lastOut(user.id);
    expect(welcome?.kind).toBe("welcome");
    expect(welcome?.body).toContain("Hi Dr Nanda, you're all set.");
    // first slot Tue 13 Oct 9:00 → draft by Fri 9 Oct, approval by Sun 11 Oct
    expect(welcome?.body).toContain("Tuesday 13 Oct, 9:00am");
    expect(welcome?.body).toContain("Friday 9 Oct, 9:00am");
    expect(welcome?.body).toContain("Sunday 11 Oct, 9:00am");
    expect(MockGateway.sent.at(-1)?.text).toBe(welcome?.body);
  });

  it("ignores unknown numbers and logs them for admin", async () => {
    await readyForWhatsApp();
    await phone({ from: "+60999999999", text: "who is this" });
    const row = await db.query.waMessages.findFirst({ where: isNull(schema.waMessages.userId) });
    expect(row?.phoneE164).toBe("+60999999999");
    expect(MockGateway.sent).toHaveLength(0);
    expect(await db.query.auditLog.findFirst({ where: eq(schema.auditLog.action, "wa.unknown_sender") })).toBeTruthy();
  });

  it("never messages users who haven't verified", async () => {
    const { user } = await readyForWhatsApp();
    const { queueMessage } = await import("@/server/whatsapp/outbox");
    await queueMessage({ userId: user.id, phone: PHONE, kind: "reply", text: "should not send" });
    expect(MockGateway.sent).toHaveLength(0);
    expect((await lastOut(user.id))?.status).toBe("failed");
  });
});

describe("inbound bundling", () => {
  it("bundles fragments, transcribes voice, describes images, classifies and acknowledges", async () => {
    const { user } = await readyForWhatsApp();
    await verify(user.id);
    const before = (await outbound(user.id)).length;

    await phone({ from: PHONE, text: "We ran a free heart screening day in Kampung Baru on Saturday" });
    await phone({ from: PHONE, media: { base64: Buffer.from("fakeimage").toString("base64"), mime: "image/jpeg" }, caption: "the team" });
    await phone({ from: PHONE, media: { base64: Buffer.alloc(3000).toString("base64"), mime: "audio/ogg" } });
    // nothing yet: waiting for silence
    expect((await outbound(user.id)).length).toBe(before);
    expect(await processDueBundles()).toBe(0);

    await travel(4 * 60_000);
    expect(await processDueBundles()).toBe(1);
    const bundle = (await db.query.inputBundles.findFirst({ where: eq(schema.inputBundles.userId, user.id), orderBy: desc(schema.inputBundles.createdAt) }))!;
    expect(bundle.intent).toBe("new_idea");
    const parts = await db.query.waMessages.findMany({ where: eq(schema.waMessages.bundleId, bundle.id) });
    expect(parts).toHaveLength(3);
    expect(parts.find((p) => p.type === "audio")?.transcript).toMatch(/transcript/i);
    expect(parts.find((p) => p.type === "image")?.mediaUrl).toBeTruthy();
    expect(await db.query.media.findFirst({ where: eq(schema.media.userId, user.id) })).toBeTruthy();

    const ack = (await outbound(user.id)).slice(before);
    expect(ack[0].body).toMatch(/^Got it, I'll draft this for Tuesday 13 Oct/);
    expect(bundle.slotId).toBeTruthy();
  });

  it('"done" closes the bundle without waiting', async () => {
    const { user } = await readyForWhatsApp();
    await verify(user.id);
    await phone({ from: PHONE, text: "Post this on Thursday please: our new cath lab opened today with the whole team there" });
    await phone({ from: PHONE, text: "done" });
    // The named day has no regular slot, so an extra one is added (it respects the 48h rule),
    // and because it's inside the draft window the draft follows straight away.
    const msgs = (await outbound(user.id)).map((m) => m.body);
    expect(msgs).toContainEqual(expect.stringMatching(/^Got it, I'll draft this for Thursday 8 Oct/));
    expect(msgs.at(-1)).toMatch(/^Here's your draft for Thu 8 Oct/);
    expect((await db.query.slots.findFirst({ where: eq(schema.slots.isExtra, true) }))?.status).toBe("pending_approval");
  });

  it("asks one follow-up when the idea is too thin, then uses the detail", async () => {
    const { user } = await readyForWhatsApp();
    await verify(user.id);
    await phone({ from: PHONE, text: "conference" });
    await phone({ from: PHONE, text: "done" });
    expect((await lastOut(user.id))?.body).toMatch(/tell me a bit more/i);
    await phone({ from: PHONE, text: "I spoke at the ASEAN cardiology summit about rural screening and three hospitals asked to partner" });
    await phone({ from: PHONE, text: "done" });
    expect((await lastOut(user.id))?.body).toMatch(/^Got it, I'll draft this/);
  });

  it("applies a persona preference and confirms", async () => {
    const { user } = await readyForWhatsApp();
    await verify(user.id);
    await phone({ from: PHONE, text: "Stop using hashtags in my posts" });
    await phone({ from: PHONE, text: "done" });
    const persona = await db.query.personas.findFirst({ where: and(eq(schema.personas.userId, user.id), eq(schema.personas.status, "active")) });
    expect((persona!.json as { voice: { hashtags: string } }).voice.hashtags).toBe("none");
    expect((await lastOut(user.id))?.body).toMatch(/skip hashtags/);
  });

  it("answers questions", async () => {
    const { user } = await readyForWhatsApp();
    await verify(user.id);
    await phone({ from: PHONE, text: "When is my next post?" });
    await phone({ from: PHONE, text: "done" });
    expect((await lastOut(user.id))?.body).toMatch(/coming up/);
  });
});

describe("outbound safety", () => {
  it("queues while disconnected, then sends when the connection is back", async () => {
    const { user } = await readyForWhatsApp();
    await verify(user.id);
    MockGateway.connected = false;
    const { queueMessage } = await import("@/server/whatsapp/outbox");
    const m = await queueMessage({ userId: user.id, phone: PHONE, kind: "reply", text: "hello later" });
    expect((await db.query.waMessages.findFirst({ where: eq(schema.waMessages.id, m.id) }))!.status).toBe("queued");
    MockGateway.connected = true;
    await sweepOutbox();
    expect((await db.query.waMessages.findFirst({ where: eq(schema.waMessages.id, m.id) }))!.status).toBe("sent");
  });

  it("falls back to email for drafts and reminders after 2 hours down", async () => {
    const { user } = await readyForWhatsApp();
    await verify(user.id);
    MockGateway.connected = false;
    const { queueMessage } = await import("@/server/whatsapp/outbox");
    const m = await queueMessage({ userId: user.id, phone: PHONE, kind: "reminder", text: "approve please", emailFallback: { to: user.email, subject: "Reminder", text: "approve please" } });
    await travel(60 * 60_000);
    await sweepOutbox();
    expect((await db.query.waMessages.findFirst({ where: eq(schema.waMessages.id, m.id) }))!.status).toBe("queued");
    await travel(61 * 60_000);
    await sweepOutbox();
    expect((await db.query.waMessages.findFirst({ where: eq(schema.waMessages.id, m.id) }))!.status).toBe("emailed");
    expect(await db.query.emails.findFirst({ where: and(eq(schema.emails.to, user.email), eq(schema.emails.subject, "Reminder")) })).toBeTruthy();
  });

  it("holds quiet-hour messages until 8am", async () => {
    const { user } = await readyForWhatsApp();
    await verify(user.id);
    const { queueMessage } = await import("@/server/whatsapp/outbox");
    const { deferQuietHours } = await import("@/server/schedule");
    const at = deferQuietHours(DateTime.fromISO("2026-10-05T23:00", { zone: KL }).toJSDate(), KL);
    const m = await queueMessage({ userId: user.id, phone: PHONE, kind: "reminder", text: "morning", sendAfter: at });
    expect((await db.query.waMessages.findFirst({ where: eq(schema.waMessages.id, m.id) }))!.status).toBe("queued");
    await travelTo("2026-10-06T08:01");
    await sweepOutbox();
    expect((await db.query.waMessages.findFirst({ where: eq(schema.waMessages.id, m.id) }))!.status).toBe("sent");
  });
});

describe("EvolutionGateway (swap with no other code changes)", () => {
  let server: Server;
  let port = 0;
  const hits: { method: string; url: string; apikey: string | undefined; body: any }[] = [];
  let state = "open";

  const readBody = (req: IncomingMessage) =>
    new Promise<any>((res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => res(b ? JSON.parse(b) : null));
    });

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const body = await readBody(req);
      hits.push({ method: req.method!, url: req.url!, apikey: req.headers.apikey as string | undefined, body });
      res.setHeader("content-type", "application/json");
      if (req.headers.apikey !== "evo-key") return res.writeHead(401).end("{}");
      if (req.url!.startsWith("/message/send")) return res.end(JSON.stringify({ key: { id: `EVO${hits.length}` } }));
      if (req.url!.startsWith("/instance/connectionState")) return res.end(JSON.stringify({ instance: { state } }));
      if (req.url!.startsWith("/instance/connect")) return res.end(JSON.stringify({ base64: "data:image/png;base64,QR", code: "abc" }));
      if (req.url!.startsWith("/chat/getBase64FromMediaMessage")) return res.end(JSON.stringify({ base64: Buffer.alloc(2048).toString("base64"), mimetype: "audio/ogg; codecs=opus" }));
      res.end("{}");
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  beforeEach(async () => {
    hits.length = 0;
    state = "open";
    await setSetting("evolution.url", `http://127.0.0.1:${port}`);
    await setSetting("evolution.api_key", "evo-key");
    await setSetting("evolution.instance", "mediwira");
    await setSetting("evolution.webhook_secret", "s3cret");
    process.env.WHATSAPP_GATEWAY = "evolution";
    setGateway(null); // factory picks Evolution from the env var
  });
  afterAll(() => {
    process.env.WHATSAPP_GATEWAY = "mock";
    setGateway(null);
  });

  const webhook = (payload: object, secret = "s3cret") =>
    webhookRoute.POST(new NextRequest(`http://x/api/webhooks/evolution?secret=${secret}`, { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } }));

  it("sends through the Evolution HTTP API", async () => {
    const { user } = await readyForWhatsApp();
    const cookie = await cookieFor("user", user.id);
    await call(verifyRoute.POST, { cookie, params: { userId: user.id }, body: {} });
    const send = hits.find((h) => h.url === "/message/sendText/mediwira");
    expect(send?.apikey).toBe("evo-key");
    expect(send?.body.number).toBe("60110000001");
    expect(send?.body.text).toMatch(/Reply YES/);
    expect((await lastOut(user.id))?.waMessageId).toMatch(/^EVO/);
  });

  it("rejects webhooks without the shared secret", async () => {
    expect((await webhook({ event: "messages.upsert", data: {} }, "wrong")).status).toBe(401);
  });

  it("ingests MESSAGES_UPSERT text and audio (downloaded via getBase64FromMediaMessage)", async () => {
    const { user } = await readyForWhatsApp();
    const cookie = await cookieFor("user", user.id);
    await call(verifyRoute.POST, { cookie, params: { userId: user.id }, body: {} });
    const code = (await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))!.whatsappVerifyCode;
    const jid = "60110000001@s.whatsapp.net";
    expect((await webhook({ event: "messages.upsert", instance: "mediwira", data: { key: { remoteJid: jid, fromMe: false, id: "W1" }, message: { conversation: `YES ${code}` }, messageTimestamp: 1791370000 } })).status).toBe(200);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))!.status).toBe("active");

    await webhook({ event: "messages.upsert", data: { key: { remoteJid: jid, fromMe: false, id: "W2" }, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 4 } } } });
    const audio = await db.query.waMessages.findFirst({ where: eq(schema.waMessages.waMessageId, "W2") });
    expect(audio?.type).toBe("audio");
    expect(audio?.transcript).toMatch(/transcript/i);
    expect(hits.some((h) => h.url === "/chat/getBase64FromMediaMessage/mediwira")).toBe(true);

    // duplicates and our own messages are ignored
    await webhook({ event: "messages.upsert", data: { key: { remoteJid: jid, fromMe: false, id: "W2" }, message: { conversation: "dup" } } });
    await webhook({ event: "messages.upsert", data: { key: { remoteJid: jid, fromMe: true, id: "W3" }, message: { conversation: "mine" } } });
    expect((await db.query.waMessages.findMany({ where: and(eq(schema.waMessages.userId, user.id), eq(schema.waMessages.direction, "in")) })).length).toBe(2);
  });

  it("tracks CONNECTION_UPDATE / QRCODE_UPDATED and reports status with a pairing QR", async () => {
    await webhook({ event: "connection.update", data: { state: "close" } });
    expect((await cachedStatus())?.state).toBe("close");
    await webhook({ event: "qrcode.updated", data: { qrcode: { base64: "data:image/png;base64,NEWQR" } } });
    expect((await cachedStatus())?.qr).toContain("NEWQR");
    state = "close";
    const g = new EvolutionGateway();
    const s = await g.getStatus();
    expect(s.state).toBe("close");
    expect(s.qr).toContain("QR");
  });

  it("registers the webhook for the three events", async () => {
    await new EvolutionGateway().registerWebhook("https://app.example.com/api/webhooks/evolution?secret=s3cret");
    const h = hits.find((x) => x.url === "/webhook/set/mediwira")!;
    expect(h.body.webhook.events).toEqual(["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"]);
    expect(h.body.webhook.url).toContain("secret=s3cret");
  });
});
