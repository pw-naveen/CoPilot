import { z } from "zod";
import { body, route } from "@/server/http";
import { setSubadminAccounts } from "@/server/services/accounts";

export const PUT = route<{ staffId: string }>(async ({ req, actor, params }) => {
  const { userIds } = await body(req, z.object({ userIds: z.array(z.string().uuid()) }));
  await setSubadminAccounts(actor, params.staffId, userIds);
  return { ok: true };
});
