import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { body, route } from "@/server/http";
import { assertUserAccess } from "@/server/scope";
import { cadenceInput, previewCadence } from "@/server/services/cadence";

/** The next 4 weeks of slots a cadence would produce, with approval deadlines. Saves nothing. */
export const POST = route<{ userId: string }>(async ({ req, actor, params }) => {
  await assertUserAccess(actor, params.userId);
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, params.userId) });
  return { preview: await previewCadence(await body(req, cadenceInput), u!.timezone) };
});
