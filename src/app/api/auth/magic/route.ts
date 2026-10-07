import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyMagicLink } from "@/server/auth";
import { appBaseUrl } from "@/server/config";
import { sessionCookieOptions } from "@/server/http";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  try {
    const s = await verifyMagicLink(token);
    const to = s.needsTotp ? "/login/totp" : s.type === "staff" ? "/admin" : "/";
    const res = NextResponse.redirect(`${appBaseUrl()}${to}`);
    res.cookies.set(SESSION_COOKIE, s.cookie, sessionCookieOptions);
    return res;
  } catch {
    return NextResponse.redirect(`${appBaseUrl()}/login?error=link`);
  }
}
