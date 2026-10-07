import { redirect } from "next/navigation";
import { optionalActor } from "@/server/page-auth";
import { Logo } from "@/components/ui";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await optionalActor();
  if (actor) redirect(actor.type === "staff" ? "/admin" : "/");
  const { error } = await searchParams;
  return (
    <main className="wash-bottom flex min-h-screen flex-col">
      <div className="flex justify-end px-6 py-6 sm:px-14">
        <Logo height={32} />
      </div>
      <div className="flex flex-1 items-center px-6 pb-24 sm:px-14">
        <LoginForm linkError={error === "link"} />
      </div>
    </main>
  );
}
