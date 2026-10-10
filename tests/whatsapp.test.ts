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
import { cachedStatus, diagnose, gatewayChoice, sendTestMessage, setGateway } from "@/server/whatsapp";
import { processDueBundles } from "@/server/whatsapp/inbound";
import { schedulerTick } from "@/server/scheduler";
import { sweepOutbox } from "@/server/whatsapp/outbox";
import { redis } from "@/server/queue";
import { call, cookieFor, inbound, resetDb, seedPeople } from "./helpers";
import * as webhookRoute from "@/app/api/webhooks/evolution/route";

const KL = "Asia/Kuala_Lumpur";
const PHONE = "+60110000001";

async function travel(ms: number) {
  await setOffsetMs((await getOffsetMs()) + ms);
}
async function travelTo(isoLocal: string) {
  await setOffsetMs(DateTime.fromISO(isoLocal, { zone: KL }).toMillis() - Date.now());
}
const phone = (body: { from: string; text?: string; caption?: string; media?: { data: Buffer; mime: string } }) => inbound(body);
const outbound = async (userId: string) =>
  db.query.waMessages.findMany({ where: and(eq(schema.waMessages.userId, userId), eq(schema.waMessages.direction, "out")), orderBy: (m, { asc }) => asc(m.createdAt) });
const lastOut = async (userId: string) => (await outbound(userId)).at(-1);

/** A user who has finished steps 2–6 and is waiting on WhatsApp verification. */
/**
 * A user who finished setup. WhatsApp is verified during sign-up now, so by the
 * time anyone exchanges messages the number is confirmed and the account live.
 * Pass `verified: false` for the case where it is not.
 */
async function readyForWhatsApp({ verified = true }: { verified?: boolean } = {}) {
  const { inScope, admin } = await seedPeople();
  const persona = mockAi.persona({ profile: { display_name: "Dr In", languages: ["en"] }, answers: [], prefs: {}, samples: [], golden: [] });
  await db
    .update(schema.users)
    .set({
      onboardingStep: verified ? 7 : 6,
      timezone: KL,
      displayName: "Dr Nanda",
      status: verified ? "active" : "onboarding",
      whatsappVerifiedAt: verified ? new Date() : null,
    })
    .where(eq(schema.users.id, inScope.id));
  await db.insert(schema.personas).values({ userId: inScope.id, version: 1, json: persona, status: "active", createdBy: "system:test" });
  await saveCadence(SYSTEM, inScope.id, { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] });
  return { user: inScope, admin };
}

/**
 * Bring an account to the state WhatsApp traffic assumes: number verified at
 * sign-up and setup finished. Verification itself is covered in auth.test.ts.
 */
async function verify(userId: string) {
  await db.update(schema.users).set({ whatsappVerifiedAt: new Date(), status: "active", onboardingStep: 7 }).where(eq(schema.users.id, userId));
  const { generateSlots } = await import("@/server/services/cadence");
  await generateSlots(userId);
}

beforeEach(async () => {
  await resetDb();
  MockGateway.connected = true;
  MockGateway.sent = [];
  setGateway(new MockGateway());
  await redis().flushdb();
  await travelTo("2026-10-05T10:00"); // Monday
});

describe("going live and the welcome (MockGateway)", () => {
  it("completing cadence activates the account, generates slots and sends the welcome", async () => {
    // Verified at sign-up, everything done except the final step.
    const { user } = await readyForWhatsApp({ verified: false });
    await db.update(schema.users).set({ whatsappVerifiedAt: new Date(), onboardingStep: 6 }).where(eq(schema.users.id, user.id));

    const { completeStep } = await import("@/server/services/onboarding");
    await completeStep(SYSTEM, user.id, 6);

    const u = (await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))!;
    expect(u.status).toBe("active");
    expect((await db.query.slots.findMany({ where: eq(schema.slots.userId, user.id) })).length).toBeGreaterThan(8);

    const welcome = await lastOut(user.id);
    expect(welcome?.kind).toBe("welcome");
    expect(welcome?.body).toContain("Hi Dr Nanda, you're all set.");
    expect(MockGateway.sent.at(-1)?.text).toBe(welcome?.body);
  });

  it("drafts the first post straight away and sends its preview link", async () => {
    const { user } = await readyForWhatsApp({ verified: false });
    await db.update(schema.users).set({ whatsappVerifiedAt: new Date(), onboardingStep: 6 }).where(eq(schema.users.id, user.id));

    const { completeStep } = await import("@/server/services/onboarding");
    await completeStep(SYSTEM, user.id, 6);

    // The welcome promises a draft, so one has to actually be on its way.
    const welcome = await lastOut(user.id);
    expect(welcome?.body).toContain("writing your first draft now");

    const out = await db.query.waMessages.findMany({
      where: and(eq(schema.waMessages.userId, user.id), eq(schema.waMessages.direction, "out")),
    });
    const draft = out.find((m) => m.kind === "draft");
    expect(draft?.body).toMatch(/\/p\/[\w-]+/);

    const post = await db.query.posts.findFirst({ where: eq(schema.posts.userId, user.id) });
    expect(post?.status).toBe("pending_approval");
    expect(post?.suggestedTopic).toBe(true);

    // The scheduler must not queue the same slot a second time.
    const slot = (await db.query.slots.findFirst({ where: eq(schema.slots.id, post!.slotId!) }))!;
    expect(slot.autoDraftAt).not.toBeNull();
  });

  it("refuses to finish setup when the number was never verified", async () => {
    const { user } = await readyForWhatsApp({ verified: false });
    await db.update(schema.users).set({ onboardingStep: 6, whatsappVerifiedAt: null }).where(eq(schema.users.id, user.id));
    const { completeStep } = await import("@/server/services/onboarding");
    await expect(completeStep(SYSTEM, user.id, 6)).rejects.toThrow();
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))!.status).toBe("onboarding");
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
    const { user } = await readyForWhatsApp({ verified: false });
    const { queueMessage } = await import("@/server/whatsapp/outbox");
    await queueMessage({ userId: user.id, phone: PHONE, kind: "reply", text: "should not send" });
    expect(MockGateway.sent).toHaveLength(0);
    expect((await lastOut(user.id))?.status).toBe("failed");
  });

  it("does not start drafting for a message from an unverified number", async () => {
    const { user } = await readyForWhatsApp({ verified: false });
    await phone({ from: PHONE, text: "here is an idea" });
    expect(await db.query.inputBundles.findFirst({ where: eq(schema.inputBundles.userId, user.id) })).toBeFalsy();
  });
});

describe("inbound bundling", () => {
  it("bundles fragments, transcribes voice, describes images, classifies and acknowledges", async () => {
    const { user } = await readyForWhatsApp();
    await verify(user.id);
    const before = (await outbound(user.id)).length;

    await phone({ from: PHONE, text: "We ran a free heart screening day in Kampung Baru on Saturday" });
    await phone({ from: PHONE, media: { data: Buffer.from("fakeimage"), mime: "image/jpeg" }, caption: "the team" });
    await phone({ from: PHONE, media: { data: Buffer.alloc(3000), mime: "audio/ogg" } });
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

  it("messages arriving at the same instant share one bundle", async () => {
    const { user } = await readyForWhatsApp();
    await verify(user.id);
    await Promise.all(["one", "two", "three", "four"].map((t) => phone({ from: PHONE, text: `part ${t} of the story about our clinic` })));
    const open = await db.query.inputBundles.findMany({ where: and(eq(schema.inputBundles.userId, user.id), isNull(schema.inputBundles.closedAt)) });
    expect(open).toHaveLength(1);
    expect(await db.query.waMessages.findMany({ where: eq(schema.waMessages.bundleId, open[0].id) })).toHaveLength(4);
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
    const { queueMessage } = await import("@/server/whatsapp/outbox");
    await queueMessage({ userId: user.id, phone: PHONE, kind: "reply", text: "Hello from CoPilot" });

    const send = hits.find((h) => h.url === "/message/sendText/mediwira");
    expect(send?.apikey).toBe("evo-key");
    expect(send?.body.number).toBe("60110000001");
    expect(send?.body.text).toBe("Hello from CoPilot");
    expect((await lastOut(user.id))?.waMessageId).toMatch(/^EVO/);
  });

  it("rejects webhooks without the shared secret", async () => {
    expect((await webhook({ event: "messages.upsert", data: {} }, "wrong")).status).toBe(401);
  });

  it("ingests MESSAGES_UPSERT text and audio (downloaded via getBase64FromMediaMessage)", async () => {
    const { user } = await readyForWhatsApp();
    const jid = "60110000001@s.whatsapp.net";
    expect((await webhook({ event: "messages.upsert", instance: "mediwira", data: { key: { remoteJid: jid, fromMe: false, id: "W1" }, message: { conversation: "an idea for a post" }, messageTimestamp: 1791370000 } })).status).toBe(200);
    expect((await db.query.waMessages.findFirst({ where: eq(schema.waMessages.waMessageId, "W1") }))?.body).toBe("an idea for a post");

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

  // Saving the credentials in Settings is what an admin actually does; if that
  // does not switch the gateway, they fill in the form and nothing happens.
  describe("choosing the gateway", () => {
    beforeEach(() => {
      delete process.env.WHATSAPP_GATEWAY;
      setGateway(null);
    });
    afterAll(() => {
      process.env.WHATSAPP_GATEWAY = "mock";
      setGateway(null);
    });

    it("uses Evolution because the settings are saved, with no env var set", async () => {
      const c = await gatewayChoice();
      expect(c.name).toBe("evolution");
      expect(c.reason).toMatch(/configured in Settings/i);
    });

    it("still lets the environment force the mock, and says so", async () => {
      process.env.WHATSAPP_GATEWAY = "mock";
      setGateway(null);
      const c = await gatewayChoice();
      expect(c.name).toBe("mock");
      expect(c.reason).toMatch(/WHATSAPP_GATEWAY=mock/);
    });

    it("falls back to the mock and names what is missing", async () => {
      await setSetting("evolution.api_key", "");
      const c = await gatewayChoice();
      expect(c.name).toBe("mock");
      expect(c.reason).toMatch(/API key/);
    });

    it("checks the real instance and reports the URL without leaking the key", async () => {
      const d = await diagnose();
      expect(d.gateway).toBe("evolution");
      expect(d.ok).toBe(true);
      expect(d.state).toBe("open");
      expect(d.target.url).toBe(`http://127.0.0.1:${port}`);
      expect(d.target.instance).toBe("mediwira");
      expect(d.target.apiKey).toBe(true);
      expect(hits.some((h) => h.url === "/instance/connectionState/mediwira")).toBe(true);
      expect(JSON.stringify(d)).not.toContain("evo-key");
    });

    it("reports the instance being down instead of throwing", async () => {
      state = "close";
      const d = await diagnose();
      expect(d.ok).toBe(false);
      expect(d.state).toBe("close");
    });

    it("surfaces a bad API key as the error it is", async () => {
      await setSetting("evolution.api_key", "wrong-key");
      setGateway(null);
      const d = await diagnose();
      expect(d.ok).toBe(false);
      expect(d.detail).toMatch(/401/);
    });

    it("sends a test message straight through the gateway", async () => {
      const r = await sendTestMessage("+60110000001", "ping");
      expect(r.gateway).toBe("evolution");
      expect(r.id).toMatch(/^EVO/);
      const send = hits.find((h) => h.url === "/message/sendText/mediwira" && h.body.text === "ping");
      expect(send?.body.number).toBe("60110000001");
    });

    /**
     * The whole live loop over real HTTP: the scheduler asks what to post about,
     * the answer arrives as an Evolution webhook, and the draft comes back with
     * a preview link — every outbound hop through /message/sendText.
     */
    it("asks for a topic, drafts the reply and sends back a preview link", async () => {
      await travelTo("2026-10-05T10:00");
      const { user } = await readyForWhatsApp();
      await verify(user.id);
      await db.delete(schema.slots).where(eq(schema.slots.userId, user.id));
      // Six days out: the topic prompt is due, the auto-draft is not.
      const publishAt = DateTime.fromISO("2026-10-11T09:00", { zone: KL }).toJSDate();
      const [slot] = await db
        .insert(schema.slots)
        .values({ userId: user.id, publishAt, approvalDeadline: new Date(publishAt.getTime() - 48 * 3600_000), status: "awaiting_input" })
        .returning();

      await schedulerTick();
      const prompt = hits.find((h) => h.url === "/message/sendText/mediwira" && /what would you like to share/i.test(h.body.text ?? ""));
      expect(prompt, "the topic prompt should go out over Evolution").toBeTruthy();
      expect(prompt!.body.number).toBe("60110000001");
      expect((await db.query.slots.findFirst({ where: eq(schema.slots.id, slot.id) }))!.topicPromptSentAt).toBeTruthy();

      // Reply on the handset, then close the bundle.
      const jid = "60110000001@s.whatsapp.net";
      await webhook({ event: "messages.upsert", data: { key: { remoteJid: jid, fromMe: false, id: "T1" }, message: { conversation: "The clinics we opened in towns with no cardiologist" } } });
      await webhook({ event: "messages.upsert", data: { key: { remoteJid: jid, fromMe: false, id: "T2" }, message: { conversation: "done" } } });
      await processDueBundles();

      const post = await db.query.posts.findFirst({ where: eq(schema.posts.userId, user.id) });
      expect(post?.status).toBe("pending_approval");
      expect(post?.suggestedTopic).toBe(false); // their topic, not one we picked

      const preview = hits.filter((h) => h.url === "/message/sendText/mediwira").map((h) => String(h.body.text)).find((t) => t.includes("/p/"));
      expect(preview, "the preview link should go out over Evolution").toBeTruthy();

      // The link resolves without a session and offers the two actions.
      const token = preview!.match(/\/p\/([\w-]+)/)![1];
      const { resolvePreview } = await import("@/server/services/posts");
      expect((await resolvePreview(token))?.id).toBe(post!.id);
    });
  });
});
