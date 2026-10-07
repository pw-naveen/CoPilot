import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { Actor } from "./actor";
import { resolveSession, SESSION_COOKIE } from "./auth";
import { HttpError, badRequest, unauthorized } from "./errors";

type Ctx<P> = { req: NextRequest; actor: Actor; params: P };
type RouteCtx<P> = { params: Promise<P> };

function toResponse(result: unknown) {
  if (result instanceof Response) return result;
  return NextResponse.json(result ?? { ok: true });
}

function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof ZodError)
    return NextResponse.json({ error: "Invalid input", issues: err.issues }, { status: 400 });
  console.error(err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** An authenticated API route. Scope checks happen in the data layer the handler calls. */
export function route<P = Record<string, string>>(fn: (ctx: Ctx<P>) => Promise<unknown>) {
  return async (req: NextRequest, rc: RouteCtx<P>) => {
    try {
      const session = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
      if (!session) throw unauthorized();
      if (session.needsTotp) throw unauthorized("Two-factor code required");
      const params = ((await rc?.params) ?? {}) as P;
      return toResponse(await fn({ req, actor: session.actor, params }));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** A route with no session (login, webhooks, tokenised preview). */
export function publicRoute<P = Record<string, string>>(fn: (ctx: { req: NextRequest; params: P }) => Promise<unknown>) {
  return async (req: NextRequest, rc: RouteCtx<P>) => {
    try {
      const params = ((await rc?.params) ?? {}) as P;
      return toResponse(await fn({ req, params }));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function body<T>(req: NextRequest, schema: ZodType<T, any, any>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw badRequest("Expected a JSON body");
  }
  return schema.parse(json);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 30 * 86400,
};
