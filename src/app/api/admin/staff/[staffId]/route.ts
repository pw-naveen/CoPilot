import { z } from "zod";
import { body, route } from "@/server/http";
import { updateSubadmin } from "@/server/services/accounts";

export const PATCH = route<{ staffId: string }>(async ({ req, actor, params }) => ({
  staff: await updateSubadmin(actor, params.staffId, await body(req, z.object({ canInvite: z.boolean().optional() }))),
}));
