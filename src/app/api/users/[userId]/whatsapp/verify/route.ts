import { z } from "zod";
import { body, route } from "@/server/http";
import { startVerification } from "@/server/services/whatsapp";

export const POST = route<{ userId: string }>(async ({ req, actor, params }) => {
  const { phone } = await body(req, z.object({ phone: z.string().trim().optional() }));
  return startVerification(actor, params.userId, phone);
});
