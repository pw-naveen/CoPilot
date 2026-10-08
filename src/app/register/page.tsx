import { redirect } from "next/navigation";
import { optionalActor } from "@/server/page-auth";
import { Logo } from "@/components/ui";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const actor = await optionalActor();
  if (actor) redirect(actor.type === "staff" ? "/admin" : "/");
  return (
    <main className="wash flex min-h-[100dvh] flex-col">
      <div className="flex justify-center px-6 py-8 sm:justify-start sm:px-10">
        <Logo height={30} />
      </div>
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <RegisterForm />
      </div>
    </main>
  );
}
