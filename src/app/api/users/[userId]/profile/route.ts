import { body, route } from "@/server/http";
import { profileInput, saveProfile } from "@/server/services/onboarding";

export const PUT = route<{ userId: string }>(async ({ req, actor, params }) => ({
  user: await saveProfile(actor, params.userId, await body(req, profileInput)),
}));
