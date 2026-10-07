import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { route } from "@/server/http";
import { enqueue } from "@/server/jobs";
import { assertUserAccess } from "@/server/scope";

type P = { userId: string };

export const GET = route<P>(async ({ actor, params }) => {
  await assertUserAccess(actor, params.userId);
  return { samples: await db.query.toneSamples.findMany({ where: eq(schema.toneSamples.userId, params.userId) }) };
});

/** (Re)generate any missing tone samples — used if the first attempt failed. */
export const POST = route<P>(async ({ actor, params }) => {
  await assertUserAccess(actor, params.userId);
  return { jobId: await enqueue("tone_generate", params.userId, {}) };
});
