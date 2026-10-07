import "dotenv/config";
import { Worker } from "bullmq";
import { QUEUES, redis } from "@/server/queue";
import { runJob } from "@/server/jobs";

/**
 * Background worker: runs every OpenAI and WhatsApp call so slow responses never
 * block the web app. Start with `npm run worker`.
 */
const workers: Worker[] = [];

workers.push(
  new Worker(QUEUES.jobs, async (job) => runJob(job.data.id), { connection: redis(), concurrency: 4 }),
);

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
