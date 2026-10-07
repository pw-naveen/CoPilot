import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userActor } from "@/server/page-auth";
import { Logo } from "@/components/ui";
import { LogoutButton } from "@/components/shell-client";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const actor = await userActor();
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, actor.id) });
  if (u?.status === "active" || u?.status === "paused") redirect("/");
  return (
    <div className="wash min-h-screen">
      <header className="mx-auto flex h-20 max-w-5xl items-center justify-between px-4 sm:px-8">
        <span className="text-[13px] text-muted">Setting up for {actor.name}</span>
        <div className="flex items-center gap-4">
          <Logo height={28} />
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-8">{children}</main>
    </div>
  );
}
