import { z } from "zod";
import { body, route } from "@/server/http";
import { saveAnswer, saveTranscript } from "@/server/services/onboarding";

/** `text` is a typed answer; `transcript` is a correction to what we heard. */
export const PUT = route<{ userId: string; key: string }>(async ({ req, actor, params }) => {
  const input = await body(
    req,
    z
      .object({ text: z.string().max(10_000).optional(), transcript: z.string().max(20_000).optional() })
      .refine((v) => v.text !== undefined || v.transcript !== undefined, "Nothing to save"),
  );
  if (input.text !== undefined) await saveAnswer(actor, params.userId, params.key, input.text);
  if (input.transcript !== undefined) await saveTranscript(actor, params.userId, params.key, input.transcript);
  return { ok: true };
});
