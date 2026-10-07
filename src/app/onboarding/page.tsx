import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userActor } from "@/server/page-auth";
import { STEPS } from "@/server/services/onboarding";

export default async function OnboardingIndex() {
  const actor = await userActor();
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, actor.id) });
  redirect(`/onboarding/${STEPS[Math.max(2, u?.onboardingStep ?? 2)]}`);
}
