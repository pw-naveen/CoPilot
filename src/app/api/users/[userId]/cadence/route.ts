import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { body, route } from "@/server/http";
import { assertUserAccess } from "@/server/scope";
import { cadenceInput, currentCadence, previewCadence, saveCadence } from "@/server/services/cadence";

type P = { userId: string };

export const GET = route<P>(async ({ actor, params }) => {
  await assertUserAccess(actor, params.userId);
  const c = await currentCadence(params.userId);
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, params.userId) });
  return { cadence: c ?? null, preview: c ? await previewCadence(c, u!.timezone) : [] };
});

export const PUT = route<P>(async ({ req, actor, params }) => {
  const row = await saveCadence(actor, params.userId, await body(req, cadenceInput));
  return { cadence: row };
});
