import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { generateSlots } from "./services/cadence";

/**
 * Repeatable jobs run by the worker. Each is idempotent so it can safely run late,
 * twice, or on demand from the dev time-travel page.
 */
export const cronJobs: Record<string, { every: number; run: () => Promise<unknown> }> = {
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
};

export async function runCron(name: string) {
  const job = cronJobs[name];
  if (!job) throw new Error(`unknown cron job ${name}`);
  return job.run();
}
