import { badRequest } from "@/server/errors";
import { route } from "@/server/http";
import { saveAudioAnswer } from "@/server/services/onboarding";
import { assertUserAccess } from "@/server/scope";

/** Multipart upload of a recorded answer (field `audio`). Returns a job to poll for the transcript. */
export const POST = route<{ userId: string; key: string }>(async ({ req, actor, params }) => {
  await assertUserAccess(actor, params.userId);
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) throw badRequest("Expected an audio file");
  return { jobId: await saveAudioAnswer(actor, params.userId, params.key, file) };
});
