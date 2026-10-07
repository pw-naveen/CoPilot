import { route } from "@/server/http";
import { requireStaff, assertUserAccess } from "@/server/scope";
import { board } from "@/server/services/posts";

export const GET = route(async ({ req, actor }) => {
  requireStaff(actor);
  const q = req.nextUrl.searchParams;
  const userId = q.get("userId") || undefined;
  if (userId) await assertUserAccess(actor, userId);
  const week = q.get("week");
  return { items: await board(actor, { userId, weekStart: week ? new Date(week) : undefined }) };
});
