import Link from "next/link";
import type { ReactNode } from "react";
import type { Actor } from "@/server/actor";
import { Icon, Logo } from "./ui";
import type { IconName } from "./icon-paths";
import { LogoutButton, NavLink } from "./shell-client";

export type NavItem = { href: string; label: string; icon: IconName };

export const STAFF_NAV: NavItem[] = [
  { href: "/admin", label: "Board", icon: "list-checks" },
  { href: "/admin/users", label: "Accounts", icon: "users-three" },
  { href: "/admin/staff", label: "Sub-admins", icon: "users-four" },
  { href: "/admin/audit", label: "Audit log", icon: "eye" },
  { href: "/admin/settings", label: "Settings", icon: "gear" },
];

export const USER_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "house" },
  { href: "/calendar", label: "Calendar", icon: "calendar-check" },
  { href: "/persona", label: "Persona", icon: "user-circle" },
  { href: "/whatsapp", label: "WhatsApp", icon: "chat-circle-dots" },
];

export function AppShell({ actor, nav, children, devTools }: { actor: Actor; nav: NavItem[]; children: ReactNode; devTools?: boolean }) {
  return (
    <div className="wash min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-8">
          <Link href={actor.type === "staff" ? "/admin" : "/"} className="flex-none">
            <Logo height={26} />
          </Link>
          <nav className="-mx-2 flex flex-1 gap-1 overflow-x-auto">
            {nav.map((n) => (
              <NavLink key={n.href} href={n.href} exact={n.href === "/" || n.href === "/admin"}>
                <Icon name={n.icon} size={18} className="text-current" />
                {n.label}
              </NavLink>
            ))}
            {devTools && (
              <NavLink href="/dev">
                <Icon name="code" size={18} className="text-current" />
                Dev
              </NavLink>
            )}
          </nav>
          <div className="hidden flex-none items-center gap-3 text-[13px] sm:flex">
            <span className="text-right leading-tight">
              <span className="block font-semibold text-ink">{actor.name}</span>
              <span className="block text-muted">
                {actor.type === "staff" ? (actor.role === "admin" ? "Admin" : "Sub-admin") : actor.email}
              </span>
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-8 sm:py-14">{children}</main>
    </div>
  );
}
