import { route } from "@/server/http";
import { resendInvite } from "@/server/services/accounts";
import { requireStaff } from "@/server/scope";

export const POST = route<{ userId: string }>(async ({ actor, params }) => {
  requireStaff(actor);
  await resendInvite(actor, params.userId);
  return { ok: true };
});
