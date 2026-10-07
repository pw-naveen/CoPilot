import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { AppShell, USER_NAV } from "@/components/shell";
import { devToolsEnabled } from "@/server/clock";
import { userActor } from "@/server/page-auth";

/** The signed-in user's area after setup. */
export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const actor = await userActor();
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, actor.id) });
  if (u && u.status !== "active" && u.status !== "paused") redirect("/onboarding");
  return (
    <AppShell actor={actor} nav={USER_NAV} devTools={devToolsEnabled()}>
      {children}
    </AppShell>
  );
}
