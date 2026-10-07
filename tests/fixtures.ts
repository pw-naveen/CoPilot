import { db, schema } from "@/db";
import * as mock from "@/server/ai/mock";
import type { seedPeople } from "./helpers";

type People = Awaited<ReturnType<typeof seedPeople>>;
type T = "in" | "out";

/** Per-account records for the scope tests: one set in the sub-admin's scope, one outside it. */
export async function makeFixtures(p: People) {
  const users = { in: p.inScope, out: p.outScope };
  const personaJson = mock.persona({
    profile: { display_name: "Dr Test", languages: ["en"] },
    answers: [],
    prefs: {},
    samples: [],
    golden: [],
  });
  const ids: Record<string, Record<T, string>> = { sample: {} as any, toneSample: {} as any, job: {} as any, slot: {} as any };
  for (const t of ["in", "out"] as T[]) {
    const u = users[t];
    await db.insert(schema.auditLog).values({ actorType: "system", actorId: "seed", userId: u.id, action: "seed", entity: "user", entityId: u.id });
    await db.insert(schema.personas).values({ userId: u.id, version: 1, json: personaJson, status: "active", createdBy: "system:test" });
    const [s] = await db.insert(schema.writingSamples).values({ userId: u.id, source: "paste", text: "x".repeat(60) }).returning();
    const [ts] = await db.insert(schema.toneSamples).values({ userId: u.id, kind: "professional_insight", prompt: "p", text: "t", personaVersion: 1 }).returning();
    const [j] = await db.insert(schema.jobs).values({ userId: u.id, kind: "tone_generate", status: "done" }).returning();
    ids.sample[t] = s.id;
    ids.toneSample[t] = ts.id;
    ids.job[t] = j.id;
    const publishAt = new Date(Date.now() + 10 * 86_400_000);
    const [sl] = await db.insert(schema.slots).values({ userId: u.id, publishAt, approvalDeadline: new Date(publishAt.getTime() - 48 * 3600_000) }).returning();
    ids.slot[t] = sl.id;
  }
  return {
    subId: p.sub.id,
    adminId: p.admin.id,
    personaJson,
    user: (t: T) => users[t],
    sample: (t: T) => ids.sample[t],
    toneSample: (t: T) => ids.toneSample[t],
    job: (t: T) => ids.job[t],
    slot: (t: T) => ids.slot[t],
  };
}

export type Fixtures = Awaited<ReturnType<typeof makeFixtures>>;
