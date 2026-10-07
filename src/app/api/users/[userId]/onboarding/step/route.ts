import { z } from "zod";
import { body, route } from "@/server/http";
import { completeStep } from "@/server/services/onboarding";

/** Complete the current setup step. */
export const POST = route<{ userId: string }>(async ({ req, actor, params }) => {
  const { step } = await body(req, z.object({ step: z.number().int().min(2).max(7) }));
  return completeStep(actor, params.userId, step);
});
