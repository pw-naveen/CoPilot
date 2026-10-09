/**
 * Why isn't it working? Checks the things that actually break a local setup,
 * in the order they bite.
 *
 *   npx tsx scripts/doctor.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import IORedis from "ioredis";
import { db, schema, pg } from "../src/db";
import { getSetting } from "../src/server/config";
import { devToolsEnabled } from "../src/server/clock";

const ok = (b: boolean, msg: string, fix?: string) => {
  console.log(`  ${b ? "ok  " : "FAIL"}  ${msg}`);
  if (!b && fix) console.log(`        → ${fix}`);
  return b;
};

console.log("\nCoPilot doctor\n");

console.log("Services");
let redisUp = false;
try {
  const r = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 1500 });
  await r.connect();
  await r.ping();
  redisUp = true;
  await r.quit();
} catch {
  /* reported below */
}
ok(redisUp, "Redis reachable", "start Redis — without it jobs are queued but never run");
ok(true, `Postgres reachable (${(await db.execute("select 1")) ? "yes" : "no"})`);

console.log("\nSchema");
try {
  const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const [{ count }] = await db.execute<{ count: string }>(
    "select count(*)::text as count from drizzle.__drizzle_migrations",
  );
  const behind = journal.entries.length - Number(count);
  ok(behind <= 0, behind > 0 ? `${behind} migration(s) not applied` : `all ${journal.entries.length} migrations applied`, "npm run db:migrate");
} catch {
  ok(false, "could not read migration state", "npm run db:migrate");
}

console.log("\nCredentials");
const key = await getSetting("openai.api_key");
ok(!!key, key ? `OpenAI key present (…${key.slice(-4)})` : "OpenAI key missing", "Admin → Settings, or OPENAI_API_KEY in .env. Without it the mock AI is used.");
const evo = await getSetting("evolution.url");
ok(!!evo, evo ? `Evolution URL set (${evo})` : "Evolution URL missing", "Admin → Settings. WHATSAPP_GATEWAY must also be 'evolution'.");
console.log(`  note  WHATSAPP_GATEWAY = ${process.env.WHATSAPP_GATEWAY || "mock"}`);
console.log(`  note  DEV_TOOLS error detail = ${devToolsEnabled() ? "ON (errors show real causes)" : "OFF (friendly messages only)"}`);

console.log("\nJob queue");
const recent = await db.query.jobs.findMany({ orderBy: desc(schema.jobs.createdAt), limit: 25 });
const stuck = recent.filter((j) => j.status === "queued" && Date.now() - j.createdAt.getTime() > 45_000);
const failed = recent.filter((j) => j.status === "failed");
ok(recent.length > 0, recent.length ? `${recent.length} recent jobs` : "no jobs yet");
ok(
  stuck.length === 0,
  stuck.length ? `${stuck.length} job(s) queued and unclaimed for over 45s` : "nothing stuck in the queue",
  "that means no worker is draining the queue — run: npm run worker",
);
ok(failed.length === 0, failed.length ? `${failed.length} recent failure(s)` : "no recent failures");
for (const j of failed.slice(0, 5)) {
  console.log(`        ${j.kind}  ${j.createdAt.toISOString()}`);
  console.log(`          ${(j.errorDetail || j.error || "no detail recorded").split("\n")[0]}`);
}

console.log("\nStuck voice notes");
const waiting = (await db.query.onboardingAnswers.findMany()).filter((a) => a.audioUrl && !a.transcript);
ok(waiting.length === 0, waiting.length ? `${waiting.length} recording(s) with no transcript` : "every recording is transcribed");
for (const a of waiting.slice(0, 5)) {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, a.userId) });
  console.log(`        ${u?.email ?? a.userId} · ${a.questionKey}`);
}

console.log("");
await pg.end();
process.exit(0);
