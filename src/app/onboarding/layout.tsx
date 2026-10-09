import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userActor } from "@/server/page-auth";

/** Chrome lives in FlowShell so every step fills the viewport identically. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const actor = await userActor();
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, actor.id) });
  if (u?.status === "active" || u?.status === "paused") redirect("/");
  return <>{children}</>;
}
