import { registerInput, registerUser } from "@/server/auth";
import { body, publicRoute } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

/** Self-service sign-up. Creates a pending account; an admin must approve it. */
export const POST = publicRoute(async ({ req }) => {
  await rateLimit(`register:ip:${clientIp(req)}`, { limit: 5, windowSeconds: 3600, message: "Too many sign-ups from this connection. Try again later." });
  const input = await body(req, registerInput);
  await registerUser(input);
  return { ok: true, pending: true };
});
