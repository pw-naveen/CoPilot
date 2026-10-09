import { redirect } from "next/navigation";
import { optionalActor } from "@/server/page-auth";
import { Logo } from "@/components/ui";
import { AmbientOrb } from "@/components/ambient-orb";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await optionalActor();
  if (actor) redirect(actor.type === "staff" ? "/admin" : "/");
  const { error } = await searchParams;
  return (
    <main className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[var(--bg)]">
      <AmbientOrb />
      <div className="relative z-10 flex justify-center px-6 py-7 sm:justify-start sm:px-10">
        <Logo height={26} />
      </div>
      <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-16">
        <LoginForm linkError={error === "link"} />
      </div>
    </main>
  );
}
