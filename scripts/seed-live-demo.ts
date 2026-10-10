/**
 * Set one account up so the real WhatsApp loop can be walked end to end:
 * the scheduler asks what to post about, you reply on your own phone, the
 * assistant drafts it and sends a preview link to approve.
 *
 *   npx tsx scripts/seed-live-demo.ts <email> <+phone> [daysOut]
 *
 * Why `daysOut` defaults to 6 rather than 1: the slot timeline runs backwards
 * from publish time — the topic prompt goes at T−7d, the automatic draft at
 * T−5d, and anything not approved by T−48h is marked missed. A slot tomorrow
 * is already past its own approval deadline, so the scheduler would mark it
 * missed on its next tick instead of ever asking you anything. Six days out is
 * the nearest date where the prompt fires immediately and the rest of the
 * timeline still has room.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema, pg } from "../src/db";
import { SYSTEM } from "../src/server/actor";
import { now as clockNow } from "../src/server/clock";
import { approvalDeadline, slotTimeline } from "../src/server/schedule";
import { saveCadence } from "../src/server/services/cadence";
import { activePersona } from "../src/server/services/persona";
import { gatewayChoice, webhookUrl } from "../src/server/whatsapp";

const [email, phone, daysArg] = process.argv.slice(2);
const daysOut = Number(daysArg ?? 6);
if (!email || !phone) {
  console.error("usage: npx tsx scripts/seed-live-demo.ts <email> <+60…> [daysOut]");
  process.exit(1);
}
if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
  console.error(`"${phone}" is not an international number, e.g. +60123456789`);
  process.exit(1);
}

const at = await clockNow();
const tz = "Asia/Kuala_Lumpur";
const step = (s: string) => console.log(`\n── ${s}`);

step("Gateway");
const choice = await gatewayChoice();
console.log(`   ${choice.name}: ${choice.reason}`);
console.log(`   webhook: ${await webhookUrl()}`);
if (choice.name === "mock")
  console.log("   ⚠ Nothing will reach a real phone until Evolution is configured in Settings.");

step("Account");
let user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
if (!user) {
  [user] = await db
    .insert(schema.users)
    .values({
      email,
      name: "Naveen",
      displayName: "Naveen",
      title: "Founder",
      org: "Mediwira",
      phoneE164: phone,
      timezone: tz,
      status: "active",
      onboardingStep: 7,
      whatsappVerifiedAt: at,
      approvedAt: at,
    })
    .returning();
  console.log(`   created ${email}`);
} else {
  [user] = await db
    .update(schema.users)
    .set({ phoneE164: phone, status: "active", onboardingStep: 7, whatsappVerifiedAt: user.whatsappVerifiedAt ?? at, timezone: user.timezone ?? tz })
    .where(eq(schema.users.id, user.id))
    .returning();
  console.log(`   updated ${email}`);
}
console.log(`   ${user.displayName} · ${user.phoneE164} · ${user.timezone} · ${user.status}`);

step("Persona");
if (await activePersona(user.id)) {
  console.log("   already has an active persona, left alone");
} else {
  await db.insert(schema.personas).values({
    userId: user.id,
    version: 1,
    status: "active",
    createdBy: "system:seed-live-demo",
    changeNote: "Seeded for the live WhatsApp walkthrough",
    json: {
      display_name: user.displayName,
      role_summary: `${user.title ?? "Founder"} at ${user.org ?? "Mediwira"}`,
      voice_summary:
        "Writes plainly and directly, in short paragraphs. Leads with the point, then one concrete example from the work. No jargon, no hype.",
      audience: ["Healthcare operators", "Clinicians", "Partners"],
      content_pillars: [
        { name: "Building the company", description: "What running a healthtech business actually involves" },
        { name: "Care delivery", description: "How care reaches people who are hard to reach" },
        { name: "Lessons from the work", description: "What went wrong and what it taught us" },
      ],
      voice: {
        formality: 0.4,
        personal: 0.6,
        length: "medium",
        emoji: "none",
        hashtags: "max 3, at the end",
        languages: ["en"],
        sentence_style: "Short sentences. One idea per paragraph.",
      },
      signature_moves: ["Leads with the point, then one example", "Ends on a question"],
      do: ["Use concrete details from the input", "Keep one idea per post"],
      dont: ["Don't use buzzwords", "Don't make claims about treatment outcomes"],
      banned_phrases: ["thrilled to announce", "game-changer", "synergy"],
      topics_to_avoid: ["identifiable patient details"],
      golden_examples: [],
    },
  });
  console.log("   seeded a starter persona (edit it at /persona)");
}

step("Cadence");
await saveCadence(SYSTEM, user.id, { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] });
console.log("   2 a week, Tue and Thu at 09:00");

step("Slot");
// Clear any open slots so the walkthrough has exactly one thing in flight.
const cleared = await db
  .delete(schema.slots)
  .where(and(eq(schema.slots.userId, user.id), eq(schema.slots.status, "awaiting_input")))
  .returning({ id: schema.slots.id });
const publishAt = DateTime.fromJSDate(at, { zone: user.timezone }).plus({ days: daysOut }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate();
const [slot] = await db
  .insert(schema.slots)
  .values({ userId: user.id, publishAt, approvalDeadline: approvalDeadline(publishAt), status: "awaiting_input" })
  .returning();
const t = slotTimeline(publishAt, user.timezone);
const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: user!.timezone }).toFormat("ccc d LLL, HH:mm");
console.log(`   cleared ${cleared.length} open slot(s)`);
console.log(`   publishes      ${fmt(publishAt)}`);
console.log(`   topic prompt   ${fmt(t.topicPromptAt)}  ${t.topicPromptAt <= at ? "← due now" : "(in the future)"}`);
console.log(`   auto-draft     ${fmt(t.autoDraftAt)}  (if you haven't replied by then)`);
console.log(`   approve by     ${fmt(t.deadline)}`);

if (t.topicPromptAt > at)
  console.log(`\n   ⚠ ${daysOut} days out means the prompt is not due yet. Use 6 or more to have it fire now.`);
if (t.deadline <= at)
  console.log(`\n   ⚠ ${daysOut} days out is already past the 48-hour approval deadline — the scheduler will mark this slot missed.`);

step("Next");
console.log(`   1. Make sure the worker is running: npm run worker`);
console.log(`   2. Within a minute the scheduler sends "${user.displayName}, what would you like to share?" to ${user.phoneE164}`);
console.log(`   3. Reply on WhatsApp with a topic, then "done" (or just wait ${process.env.DEBOUNCE_SECONDS ?? 180}s)`);
console.log(`   4. The assistant drafts it and sends a preview link to approve or revise`);
console.log(`   Watch it: /admin/users/${user.id}\n`);

await pg.end();
