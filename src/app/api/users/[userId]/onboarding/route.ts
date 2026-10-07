import { route } from "@/server/http";
import { onboardingState } from "@/server/services/onboarding";

export const GET = route<{ userId: string }>(async ({ actor, params }) => onboardingState(actor, params.userId));
