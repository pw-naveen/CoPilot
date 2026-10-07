import { z } from "zod";
import { badRequest } from "@/server/errors";
import { body, route } from "@/server/http";
import { addSample } from "@/server/services/onboarding";
import { assertUserAccess } from "@/server/scope";

/** Paste a sample (JSON {text, source}) or upload a .txt/.md file (multipart field `file`). */
export const POST = route<{ userId: string }>(async ({ req, actor, params }) => {
  await assertUserAccess(actor, params.userId);
  if (req.headers.get("content-type")?.startsWith("multipart/")) {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) throw badRequest("Expected a file");
    if (!/\.(txt|md)$/i.test(file.name) && !file.type.startsWith("text/")) throw badRequest("Upload a .txt or .md file, or paste the text");
    return { sample: await addSample(actor, params.userId, await file.text(), file.name) };
  }
  const { text, source } = await body(req, z.object({ text: z.string(), source: z.string().default("paste") }));
  return { sample: await addSample(actor, params.userId, text, source) };
});
