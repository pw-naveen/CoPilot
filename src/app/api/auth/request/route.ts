import { z } from "zod";
import { requestLogin } from "@/server/auth";
import { body, publicRoute } from "@/server/http";

export const POST = publicRoute(async ({ req }) => {
  const { email } = await body(req, z.object({ email: z.string().email() }));
  await requestLogin(email);
  return { ok: true }; // same answer whether or not the email exists
});
