import { AppShell, STAFF_NAV } from "@/components/shell";
import { devToolsEnabled } from "@/server/clock";
import { staffActor } from "@/server/page-auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await staffActor();
  const nav = actor.role === "admin" ? STAFF_NAV : STAFF_NAV.filter((n) => n.href !== "/admin/staff");
  return (
    <AppShell actor={actor} nav={nav} devTools={devToolsEnabled()}>
      {children}
    </AppShell>
  );
}
