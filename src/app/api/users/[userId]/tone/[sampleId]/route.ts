import { body, route } from "@/server/http";
import { toneFeedback, toneFeedbackInput } from "@/server/services/tone";

export const POST = route<{ userId: string; sampleId: string }>(async ({ req, actor, params }) =>
  toneFeedback(actor, params.userId, params.sampleId, await body(req, toneFeedbackInput)),
);
