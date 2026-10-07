import { z } from "zod";
import { body, route } from "@/server/http";
import { saveAnswer } from "@/server/services/onboarding";

export const PUT = route<{ userId: string; key: string }>(async ({ req, actor, params }) => {
  const { text } = await body(req, z.object({ text: z.string().max(10_000) }));
  await saveAnswer(actor, params.userId, params.key, text);
  return { ok: true };
});
