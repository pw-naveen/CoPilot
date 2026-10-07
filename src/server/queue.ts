import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

/** BullMQ queues. The web app only enqueues; the worker process runs everything. */
export const QUEUES = {
  jobs: "jobs", // on-demand AI work requested from the web app (browser polls `jobs` table)
  inbound: "inbound", // WhatsApp debounce → bundle processing
  outbox: "outbox", // spaced outbound WhatsApp sends
  drafts: "drafts", // draft generation + review pass
  cron: "cron", // repeatable: scheduler tick, slot generation, health, retention
} as const;

let conn: IORedis | null = null;
export function redis() {
  return (conn ??= new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null }));
}

const queues = new Map<string, Queue>();
export function queue(name: (typeof QUEUES)[keyof typeof QUEUES]) {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis(), defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } });
    queues.set(name, q);
  }
  return q;
}

export async function addJob(name: (typeof QUEUES)[keyof typeof QUEUES], jobName: string, data: unknown, opts?: JobsOptions) {
  return queue(name).add(jobName, data, opts);
}
