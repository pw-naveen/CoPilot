import { db, schema } from "@/db";
import type { seedPeople } from "./helpers";

type People = Awaited<ReturnType<typeof seedPeople>>;

/** Per-account records for the scope tests: one set in the sub-admin's scope, one outside it. */
export async function makeFixtures(p: People) {
  const users = { in: p.inScope, out: p.outScope };
  for (const u of Object.values(users)) {
    await db.insert(schema.auditLog).values({ actorType: "system", actorId: "seed", userId: u.id, action: "seed", entity: "user", entityId: u.id });
  }
  return {
    subId: p.sub.id,
    adminId: p.admin.id,
    user: (t: "in" | "out") => users[t],
  };
}

export type Fixtures = Awaited<ReturnType<typeof makeFixtures>>;
