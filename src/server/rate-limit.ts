import { redis } from "./queue";
import { HttpError } from "./errors";

/**
 * Fixed-window counter in Redis. The previous passwordless sign-in capped OTP
 * guesses at five per token; password sign-in has no such natural ceiling, so
 * the limit lives here instead.
 *
 * Fails open: if Redis is unreachable the request is allowed rather than
 * locking everyone out of the product because the cache is down.
 */
export async function rateLimit(
  key: string,
  { limit, windowSeconds, message }: { limit: number; windowSeconds: number; message?: string },
) {
  let count: number;
  try {
    const k = `rl:${key}`;
    count = await redis().incr(k);
    if (count === 1) await redis().expire(k, windowSeconds);
  } catch {
    return;
  }
  if (count > limit) throw new HttpError(429, message ?? "Too many attempts. Try again shortly.");
}

/** Best-effort client address, for limiting by origin as well as by account. */
export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for");
  return (fwd?.split(",")[0].trim() || h.get("x-real-ip") || "unknown").slice(0, 64);
}
