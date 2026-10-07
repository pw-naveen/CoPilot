import { notFound } from "next/navigation";
import { AppShell, STAFF_NAV, USER_NAV } from "@/components/shell";
import { devToolsEnabled } from "@/server/clock";
import { optionalActor } from "@/server/page-auth";
import { Logo } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Development-only tools: mailbox, mock WhatsApp phone, time travel. */
export default async function DevLayout({ children }: { children: React.ReactNode }) {
  if (!devToolsEnabled()) notFound();
  const actor = await optionalActor();
  if (!actor)
    return (
      <div className="wash min-h-screen">
        <header className="flex h-16 items-center border-b border-line bg-white px-8"><Logo height={26} /></header>
        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-8">{children}</main>
      </div>
    );
  return (
    <AppShell actor={actor} nav={actor.type === "staff" ? STAFF_NAV : USER_NAV} devTools>
      {children}
    </AppShell>
  );
}
