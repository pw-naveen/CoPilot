import "dotenv/config";
import { Worker, type Processor } from "bullmq";
import { QUEUES, queue, redis } from "@/server/queue";
import { runJob } from "@/server/jobs";
import { cronJobs, runCron } from "@/server/cron";
import { processWebhook } from "@/server/whatsapp/inbound";
import { processBundle } from "@/server/whatsapp/bundle";
import { deliver } from "@/server/whatsapp/outbox";
import { generateDraftForSlot, refreshPersonaFromEdits, reviseDraft } from "@/server/services/posts";

/**
 * Background worker: runs every OpenAI and WhatsApp call so slow responses never
 * block the web app. Start with `npm run worker`.
 */
const workers: Worker[] = [];
const add = (name: string, fn: Processor, concurrency = 4) => workers.push(new Worker(name, fn, { connection: redis(), concurrency }));

add(QUEUES.jobs, async (job) => runJob(job.data.id));

add(QUEUES.inbound, async (job) => {
  if (job.name === "webhook") return processWebhook(job.data.source, job.data.payload).then((e) => e.length);
  if (job.name === "bundle") return processBundle(job.data.bundleId);
});

// One at a time, so sends stay spaced out.
add(QUEUES.outbox, async (job) => deliver(job.data.id), 1);

add(QUEUES.drafts, async (job) => {
  if (job.name === "generate") return generateDraftForSlot(job.data.slotId, job.data);
  if (job.name === "revise") return reviseDraft(job.data);
  if (job.name === "persona-refresh") return refreshPersonaFromEdits(job.data.userId);
}, 2);

add(QUEUES.cron, async (job) => runCron(job.name), 1);

// Register repeatable jobs (same scheduler id replaces the old definition).
for (const [name, def] of Object.entries(cronJobs)) {
  await queue(QUEUES.cron).upsertJobScheduler(name, { every: def.every }, { name });
}

for (const w of workers) {
  w.on("failed", (job, err) => console.error(`[worker] ${w.name}/${job?.name} failed:`, err.message));
}

console.log(`[worker] running queues: ${workers.map((w) => w.name).join(", ")}`);

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
