import { z } from "zod";
import { body, route } from "@/server/http";
import { restoreVersion } from "@/server/services/persona";

export const POST = route<{ userId: string }>(async ({ req, actor, params }) => {
  const { version } = await body(req, z.object({ version: z.number().int().positive() }));
  return { version: (await restoreVersion(actor, params.userId, version)).version };
});
