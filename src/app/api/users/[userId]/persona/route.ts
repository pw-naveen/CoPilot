import { z } from "zod";
import { body, route } from "@/server/http";
import { personaSchema } from "@/server/persona-schema";
import { editPersona, listVersions } from "@/server/services/persona";

type P = { userId: string };

export const GET = route<P>(async ({ actor, params }) => {
  const versions = await listVersions(actor, params.userId);
  return { active: versions.find((v) => v.status === "active") ?? null, versions };
});

/** Save an edited persona as a new version. */
export const PUT = route<P>(async ({ req, actor, params }) => {
  const { json, note } = await body(req, z.object({ json: personaSchema, note: z.string().max(300).optional() }));
  const row = await editPersona(actor, params.userId, json, note);
  return { version: row.version };
});
