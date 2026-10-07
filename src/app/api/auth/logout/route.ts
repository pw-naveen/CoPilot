import { NextResponse } from "next/server";
import { destroySession, SESSION_COOKIE } from "@/server/auth";
import { publicRoute } from "@/server/http";

export const POST = publicRoute(async ({ req }) => {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (raw) await destroySession(raw);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
