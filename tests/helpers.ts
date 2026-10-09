import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSession } from "@/server/auth";
import { redis } from "@/server/queue";
import { resetClockCache } from "@/server/clock";

export async function resetDb() {
  const tables = Object.values(schema)
    .filter((t: any) => t && typeof t === "object" && Symbol.for("drizzle:Name") in t)
    .map((t: any) => `"${t[Symbol.for("drizzle:Name")]}"`);
  await db.execute(sql.raw(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`));
  // Rate-limit counters live in Redis, not Postgres, so truncating tables alone
  // would carry one test's attempts into the next. Best-effort: the limiter
  // itself fails open, so a suite that only touches Postgres should not hang
  // for minutes because Redis happens to be down.
  try {
    const keys = await Promise.race([
      redis().keys("rl:*"),
      new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error("redis timeout")), 2000)),
    ]);
    if (keys.length) await redis().del(...keys);
  } catch {
    /* Redis unavailable; rate-limit tests will report it themselves. */
  }
  resetClockCache();
}

export async function seedPeople() {
  const [admin] = await db.insert(schema.staff).values({ email: "admin@test.dev", name: "Admin", role: "admin" }).returning();
  const [sub] = await db
    .insert(schema.staff)
    .values({ email: "sub@test.dev", name: "Sub", role: "subadmin", canInvite: true })
    .returning();
  const mk = (n: string, phone: string) =>
    db
      .insert(schema.users)
      .values({ email: `${n}@test.dev`, name: `Dr ${n}`, displayName: `Dr ${n}`, phoneE164: phone, status: "onboarding", onboardingStep: 2 })
      .returning()
      .then((r) => r[0]);
  const inScope = await mk("inscope", "+60110000001");
  const outScope = await mk("outscope", "+60110000002");
  await db.insert(schema.subadminAccounts).values({ staffId: sub.id, userId: inScope.id });
  return { admin, sub, inScope, outScope };
}

export async function cookieFor(type: "staff" | "user", id: string) {
  const s = await createSession(type, id);
  return `sid=${s.cookie}`;
}

type Handler = (req: NextRequest, ctx: { params: Promise<any> }) => Promise<Response>;

export async function call(
  handler: Handler,
  opts: { method?: string; path?: string; cookie?: string; body?: unknown; params?: Record<string, string>; form?: FormData } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const req = new NextRequest(`http://localhost:3000${opts.path ?? "/api/x"}`, {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers,
    body,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json: json as any };
}
