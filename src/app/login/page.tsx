import { redirect } from "next/navigation";
import { optionalActor } from "@/server/page-auth";
import { Logo } from "@/components/ui";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await optionalActor();
  if (actor) redirect(actor.type === "staff" ? "/admin" : "/");
  const { error } = await searchParams;
  return (
    <main className="wash flex min-h-[100dvh] flex-col">
      <div className="flex justify-center px-6 py-8 sm:justify-start sm:px-10">
        <Logo height={30} />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-20">
        <LoginForm linkError={error === "link"} />
      </div>
    </main>
  );
}
