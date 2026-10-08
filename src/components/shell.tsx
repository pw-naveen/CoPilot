import Link from "next/link";
import type { ReactNode } from "react";
import type { Actor } from "@/server/actor";
import { Icon, Logo } from "./ui";
import type { IconName } from "./icon-paths";
import { LogoutButton, Rail, TabBar, type NavItem } from "./shell-client";

export type { NavItem };

export const STAFF_NAV: NavItem[] = [
  { href: "/admin", label: "Board", icon: "list-checks" },
  { href: "/admin/users", label: "Accounts", icon: "users-three" },
  { href: "/admin/staff", label: "Sub-admins", icon: "users-four" },
  { href: "/admin/audit", label: "Audit", icon: "eye" },
  { href: "/admin/settings", label: "Settings", icon: "gear" },
];

export const USER_NAV: NavItem[] = [
  { href: "/calendar", label: "Calendar", icon: "calendar-check" },
  { href: "/persona", label: "Persona", icon: "user-circle" },
  { href: "/whatsapp", label: "WhatsApp", icon: "chat-circle-dots" },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

/**
 * App frame: a rail on desktop, a tab bar within thumb reach on mobile. Both are
 * driven by the same nav list, so a route only has to be declared once.
 */
export function AppShell({ actor, nav, children, devTools }: { actor: Actor; nav: NavItem[]; children: ReactNode; devTools?: boolean }) {
  const items = devTools ? [...nav, { href: "/dev", label: "Dev", icon: "code" as IconName }] : nav;
  const home = actor.type === "staff" ? "/admin" : "/";
  const role = actor.type === "staff" ? (actor.role === "admin" ? "Admin" : "Sub-admin") : actor.email;

  return (
    <div className="wash min-h-[100dvh]">
      {/* Desktop rail: one continuous edge against the page, not a floating card. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[88px] flex-col items-stretch gap-5 border-r border-line bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] px-3 py-4 backdrop-blur-xl md:flex">
        <Link href={home} className="grid h-9 place-items-center" aria-label="Home">
          <Logo variant="mark" height={24} />
        </Link>
        <Rail items={items} />
      </aside>

      <div className="md:pl-[88px]">
        <header className="sticky top-0 z-20 border-b border-line bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-3 px-4 sm:px-7">
            <Link href={home} className="flex-none md:hidden" aria-label="Home">
              <Logo height={22} />
            </Link>
            <span className="hidden text-[13px] font-semibold tracking-[-0.01em] text-ink md:block">CoPilot</span>
            <div className="min-w-0 flex-1" />
            <div className="flex flex-none items-center gap-3">
              <span className="hidden text-right text-[12px] leading-tight sm:block">
                <span className="block font-semibold text-ink">{actor.name}</span>
                <span className="block text-muted">{role}</span>
              </span>
              <span
                aria-hidden
                className="grid h-8 w-8 place-items-center rounded-full border border-blush-300 bg-blush-100 text-[12px] font-bold text-red-text"
              >
                {initials(actor.name) || <Icon name="user" size={16} className="text-current" />}
              </span>
              <LogoutButton />
            </div>
          </div>
        </header>

        {/* Bottom padding clears the mobile tab bar. */}
        <main className="mx-auto max-w-[1320px] px-4 pt-7 pb-28 sm:px-7 sm:pt-9 md:pb-16">{children}</main>
      </div>

      <TabBar items={items} />
    </div>
  );
}
