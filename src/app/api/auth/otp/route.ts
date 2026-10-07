import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, verifyOtp } from "@/server/auth";
import { body, publicRoute, sessionCookieOptions } from "@/server/http";

export const POST = publicRoute(async ({ req }) => {
  const { email, code } = await body(req, z.object({ email: z.string().email(), code: z.string().min(6).max(6) }));
  const s = await verifyOtp(email, code);
  const res = NextResponse.json({ next: s.needsTotp ? "/login/totp" : s.type === "staff" ? "/admin" : "/" });
  res.cookies.set(SESSION_COOKIE, s.cookie, sessionCookieOptions);
  return res;
});
