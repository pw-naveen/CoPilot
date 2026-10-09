import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { sendWhatsappCode, verifyWhatsappCode } from "@/server/auth";
import { notFound } from "@/server/errors";
import { body, publicRoute } from "@/server/http";
import { clientIp, rateLimit } from "@/server/rate-limit";

/** Confirm the number with the code, or ask for a new one. Public: the account
 *  cannot sign in yet, so this is the only way to finish signing up. */
export const POST = publicRoute(async ({ req }) => {
  const input = await body(
    req,
    z.object({ email: z.string().email(), code: z.string().trim().min(4).max(8).optional(), resend: z.boolean().optional() }),
  );
  const email = input.email.trim().toLowerCase();
  await rateLimit(`wa:ip:${clientIp(req)}`, { limit: 20, windowSeconds: 900 });

  if (input.resend) {
    // Tighter than verification: each resend sends a real message.
    await rateLimit(`wa:resend:${email}`, { limit: 3, windowSeconds: 900, message: "Too many codes requested. Try again in 15 minutes." });
    const u = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (!u) throw notFound();
    await sendWhatsappCode(u.id);
    return { sent: true };
  }

  await rateLimit(`wa:verify:${email}`, { limit: 10, windowSeconds: 900, message: "Too many attempts. Try again in 15 minutes." });
  if (!input.code) throw notFound();
  const r = await verifyWhatsappCode(email, input.code);
  return { verified: true, alreadyVerified: r.alreadyVerified };
});
