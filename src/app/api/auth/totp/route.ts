import { z } from "zod";
import { SESSION_COOKIE, verifySessionTotp } from "@/server/auth";
import { unauthorized } from "@/server/errors";
import { body, publicRoute } from "@/server/http";

export const POST = publicRoute(async ({ req }) => {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) throw unauthorized();
  const { code } = await body(req, z.object({ code: z.string().min(6).max(6) }));
  await verifySessionTotp(raw, code);
  return { next: "/admin" };
});
