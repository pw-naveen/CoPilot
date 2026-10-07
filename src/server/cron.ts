import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { now as clockNow } from "./clock";
import { generateSlots } from "./services/cadence";

/**
 * Repeatable jobs run by the worker. Each is idempotent so it can safely run late,
 * twice, or on demand from the dev time-travel page.
 */
export const cronJobs: Record<string, { every: number; run: () => Promise<unknown> }> = {
  // The slot timeline: topic prompts, auto-drafts, reminders, missed deadlines.
  "scheduler.tick": {
    every: 60_000,
    async run() {
      const { schedulerTick } = await import("./scheduler");
      return schedulerTick();
    },
  },
  // Rolling 6-week slot generation for every active user.
  "slots.generate": {
    every: 24 * 3600_000,
    async run() {
      const users = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.status, "active"));
      let created = 0;
      for (const u of users) created += (await generateSlots(u.id)).length;
      return { users: users.length, created };
    },
  },
  // Retry queued WhatsApp messages; email fallback after 2 hours.
  "outbox.sweep": {
    every: 60_000,
    async run() {
      const { sweepOutbox } = await import("./whatsapp/outbox");
      return sweepOutbox();
    },
  },
  // Safety net for the debounce: bundles that went quiet but were never processed.
  "bundles.sweep": {
    every: 60_000,
    async run() {
      const { processDueBundles } = await import("./whatsapp/inbound");
      return processDueBundles();
    },
  },
  // WhatsApp connection health; emails admins when the session drops.
  "wa.health": {
    every: 5 * 60_000,
    async run() {
      const { checkConnection } = await import("./whatsapp");
      return checkConnection();
    },
  },
  // Keep raw WhatsApp payloads for 90 days, then delete them.
  "retention.wa_raw": {
    every: 24 * 3600_000,
    async run() {
      const cutoff = new Date((await clockNow()).getTime() - 90 * 86_400_000);
      const res = await db
        .update(schema.waMessages)
        .set({ rawJson: null })
        .where(and(isNotNull(schema.waMessages.rawJson), lt(schema.waMessages.createdAt, cutoff)))
        .returning({ id: schema.waMessages.id });
      return { cleared: res.length };
    },
  },
};

export async function runCron(name: string) {
  const job = cronJobs[name];
  if (!job) throw new Error(`unknown cron job ${name}`);
  return job.run();
}
