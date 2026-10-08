import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, loginWithPassword } from "@/server/auth";
import { body, publicRoute, sessionCookieOptions } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const POST = publicRoute(async ({ req }) => {
  const { email, password } = await body(req, z.object({ email: z.string().email(), password: z.string().min(1) }));
  // Both, so one attacker can't spread guesses across accounts and a targeted
  // account can't be locked out by someone else's address alone.
  await rateLimit(`login:ip:${clientIp(req)}`, { limit: 30, windowSeconds: 900 });
  await rateLimit(`login:email:${email.trim().toLowerCase()}`, { limit: 10, windowSeconds: 900, message: "Too many sign-in attempts. Try again in 15 minutes." });
  const s = await loginWithPassword(email, password);
  const res = NextResponse.json({ next: s.needsTotp ? "/login/totp" : s.type === "staff" ? "/admin" : "/" });
  res.cookies.set(SESSION_COOKIE, s.cookie, sessionCookieOptions);
  return res;
});
