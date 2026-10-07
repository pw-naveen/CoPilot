import { route } from "@/server/http";
import { isUuid } from "@/server/scope";
import { notFound } from "@/server/errors";
import { skipSlot } from "@/server/services/cadence";

export const POST = route<{ slotId: string }>(async ({ actor, params }) => {
  if (!isUuid(params.slotId)) throw notFound();
  await skipSlot(actor, params.slotId);
  return { ok: true };
});
