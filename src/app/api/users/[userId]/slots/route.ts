import { route } from "@/server/http";
import { listSlots } from "@/server/services/cadence";

export const GET = route<{ userId: string }>(async ({ req, actor, params }) => {
  const q = req.nextUrl.searchParams;
  const from = q.get("from") ? new Date(q.get("from")!) : undefined;
  const to = q.get("to") ? new Date(q.get("to")!) : undefined;
  return { slots: await listSlots(actor, params.userId, { from, to }) };
});
