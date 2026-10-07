import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * The one source of "now" for scheduling. In development the offset can be moved
 * forward (time travel) so the scheduler can be exercised without waiting days.
 */
const KEY = "dev.clock_offset_ms";
let cache: { offset: number; at: number } | null = null;

export const devToolsEnabled = () =>
  process.env.DEV_TOOLS === "1" && process.env.NODE_ENV !== "production";

async function offset(): Promise<number> {
  if (!devToolsEnabled()) return 0;
  if (cache && Date.now() - cache.at < 1000) return cache.offset;
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, KEY) });
  cache = { offset: row ? Number(row.value) : 0, at: Date.now() };
  return cache.offset;
}

export async function now(): Promise<Date> {
  return new Date(Date.now() + (await offset()));
}

/** Tests reset the database underneath the cache. */
export function resetClockCache() {
  cache = null;
}

export async function getOffsetMs() {
  return offset();
}

export async function setOffsetMs(ms: number) {
  if (!devToolsEnabled()) throw new Error("time travel is only available with DEV_TOOLS=1");
  await db
    .insert(schema.settings)
    .values({ key: KEY, value: String(ms) })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(ms) } });
  cache = null;
}
