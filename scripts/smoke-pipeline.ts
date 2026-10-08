/**
 * End-to-end smoke test of the content pipeline, from an approved account to an
 * approved post. Runs against whatever gateway and AI provider are configured:
 * with the mock gateway it proves the wiring, with Evolution and an OpenAI key
 * it exercises the real path and a message lands on the phone.
 *
 *   npx tsx scripts/smoke-pipeline.ts [email]
 */
import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";
import { db, schema, pg } from "../src/db";
import { SYSTEM } from "../src/server/actor";
import { getSetting } from "../src/server/config";
import { saveCadence, generateSlots } from "../src/server/services/cadence";
import { generateDraftForSlot, approvePost } from "../src/server/services/posts";
import { activePersona } from "../src/server/services/persona";

const email = process.argv[2] || "nanda@example.com";
const step = (n: string) => console.log(`\n── ${n}`);
const ok = (b: boolean, m: string) => console.log(`   ${b ? "PASS" : "FAIL"}  ${m}`);
let failures = 0;
const check = (b: boolean, m: string) => { ok(b, m); if (!b) failures++; };

step("Configuration");
const gateway = process.env.WHATSAPP_GATEWAY || "mock";
console.log(`   gateway        ${gateway}`);
console.log(`   openai key     ${(await getSetting("openai.api_key")) ? "set (real AI)" : "absent (mock AI)"}`);
console.log(`   evolution url  ${(await getSetting("evolution.url")) || "absent"}`);

const u = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
if (!u) { console.error(`No user ${email}`); process.exit(1); }

step("Account state");
check(u.status === "active" || u.status === "onboarding", `account ${email} is ${u.status}`);
const persona = await activePersona(u.id);
check(!!persona, persona ? `persona v${persona.version} active` : "no active persona — run the questionnaire first");
if (!persona) { console.log("\nStopping: a persona is required before drafting."); await pg.end(); process.exit(1); }

step("Cadence and slots");
await saveCadence(SYSTEM, u.id, { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] });
await generateSlots(u.id);
const slots = await db.query.slots.findMany({ where: eq(schema.slots.userId, u.id), orderBy: (s, { asc }) => asc(s.publishAt) });
check(slots.length > 0, `${slots.length} slots generated`);

step("Draft generation");
const slot = slots.find((s) => s.status === "awaiting_input") ?? slots[0];
await generateDraftForSlot(slot.id, { suggestedTopic: "Why prevention matters more than procedures" });
const post = await db.query.posts.findFirst({ where: eq(schema.posts.slotId, slot.id), orderBy: desc(schema.posts.createdAt) });
check(!!post, "post created for the slot");
check(post?.status === "pending_approval", `post status is ${post?.status} (expected pending_approval)`);
const version = post?.currentVersionId
  ? await db.query.postVersions.findFirst({ where: eq(schema.postVersions.id, post.currentVersionId) })
  : null;
check(!!version?.text, `draft text generated (${version?.text?.length ?? 0} chars)`);
if (version?.text) console.log(`\n   ── draft ──\n${version.text.split("\n").map((l) => "   " + l).join("\n")}\n`);

step("WhatsApp delivery");
const outbound = await db.query.waMessages.findMany({
  where: and(eq(schema.waMessages.userId, u.id), eq(schema.waMessages.direction, "out")),
  orderBy: desc(schema.waMessages.createdAt),
  limit: 3,
});
const approval = outbound.find((m) => (m.body ?? "").includes("/p/"));
check(!!approval, "approval message queued to WhatsApp with a preview link");
check(!!approval && ["sent", "queued", "emailed"].includes(approval.status), `delivery status: ${approval?.status}`);
if (approval) console.log(`   to ${approval.phoneE164} · ${String(approval.body).slice(0, 110).replace(/\n/g, " ")}…`);

step("Approval reply");
if (post) {
  await approvePost(SYSTEM, post.id, "whatsapp");
  const after = await db.query.posts.findFirst({ where: eq(schema.posts.id, post.id) });
  check(after?.status === "approved", `post status after approve: ${after?.status}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
await pg.end();
process.exit(failures === 0 ? 0 : 1);
