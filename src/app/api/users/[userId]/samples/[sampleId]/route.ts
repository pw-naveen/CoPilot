import { route } from "@/server/http";
import { deleteSample } from "@/server/services/onboarding";

export const DELETE = route<{ userId: string; sampleId: string }>(async ({ actor, params }) => {
  await deleteSample(actor, params.userId, params.sampleId);
  return { ok: true };
});
