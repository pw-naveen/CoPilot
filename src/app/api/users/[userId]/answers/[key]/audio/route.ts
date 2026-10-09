import { badRequest } from "@/server/errors";
import { route } from "@/server/http";
import { clearAudioAnswer, retryTranscription, saveAudioAnswer } from "@/server/services/onboarding";
import { assertUserAccess } from "@/server/scope";

/** Multipart upload of a recorded answer (field `audio`). Returns a job to poll for the transcript. */
export const POST = route<{ userId: string; key: string }>(async ({ req, actor, params }) => {
  await assertUserAccess(actor, params.userId);
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) throw badRequest("Expected an audio file");
  return { jobId: await saveAudioAnswer(actor, params.userId, params.key, file) };
});

/** Discards a recorded answer so the user can type it or record again. */
export const DELETE = route<{ userId: string; key: string }>(async ({ actor, params }) => {
  await clearAudioAnswer(actor, params.userId, params.key);
  return { ok: true };
});

/** Re-queue transcription for a recording that is already stored. */
export const PUT = route<{ userId: string; key: string }>(async ({ actor, params }) => {
  return { jobId: await retryTranscription(actor, params.userId, params.key) };
});
