import { route } from "@/server/http";
import { listAudit } from "@/server/services/accounts";

export const GET = route(async ({ req, actor }) => {
  const userId = req.nextUrl.searchParams.get("userId") ?? undefined;
  return { entries: await listAudit(actor, { userId }) };
});
