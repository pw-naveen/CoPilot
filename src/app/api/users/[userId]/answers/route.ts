import { route } from "@/server/http";
import { answerStates } from "@/server/services/onboarding";

/** Polled by the questionnaire while a voice note is still being transcribed. */
export const GET = route<{ userId: string }>(async ({ actor, params }) => answerStates(actor, params.userId));
