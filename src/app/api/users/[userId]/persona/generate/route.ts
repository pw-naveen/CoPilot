import { z } from "zod";
import { actorRef } from "@/server/actor";
import { audit } from "@/server/audit";
import { body, route } from "@/server/http";
import { enqueue } from "@/server/jobs";
import { assertUserAccess } from "@/server/scope";

/** Regenerate the persona, optionally with a note ("less corporate"). */
export const POST = route<{ userId: string }>(async ({ req, actor, params }) => {
  await assertUserAccess(actor, params.userId);
  const { note } = await body(req, z.object({ note: z.string().trim().max(500).default("") }));
  await audit(actor, { action: "persona.regenerate", entity: "persona", userId: params.userId, after: { note } });
  return { jobId: await enqueue("persona_generate", params.userId, { note, by: actorRef(actor) }) };
});
