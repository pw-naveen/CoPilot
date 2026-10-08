"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, cx } from "./ui";
import type { IconName } from "./icon-paths";

export type NavItem = { href: string; label: string; icon: IconName };

const isActive = (path: string, href: string, exact?: boolean) =>
  exact ? path === href : path === href || path.startsWith(href + "/");

const exactFor = (href: string) => href === "/" || href === "/admin";

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: ReactNode }) {
  const path = usePathname();
  const active = isActive(path, href, exact);
  return (
    <Link
      href={href}
      className={cx(
        "relative flex h-16 items-center gap-2 px-3 text-[14px] font-medium whitespace-nowrap transition-colors",
        active ? "text-ink" : "text-muted hover:text-red-text",
      )}
    >
      {children}
      {active && <span className="absolute inset-x-3 bottom-0 h-[3px]" style={{ background: "var(--gradient-pulse)" }} />}
    </Link>
  );
}

/**
 * Desktop rail. Icon over label at 11px, with the active item marked by a tinted
 * well and a red spine rather than a filled red tile — a solid accent block per
 * item competes with the content for the eye.
 */
export function Rail({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((n) => {
        const active = isActive(path, n.href, exactFor(n.href));
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            title={n.label}
            className={cx(
              "group relative flex flex-col items-center gap-1 rounded-[10px] px-1 py-2.5 text-[10px] font-semibold tracking-[0.02em] transition-colors duration-150",
              active ? "bg-blush-100 text-ink" : "text-muted hover:bg-[rgba(255,255,255,0.04)] hover:text-ink-soft",
            )}
          >
            {active && <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-2 w-[2px] rounded-full bg-red" />}
            <Icon name={n.icon} size={19} className={cx("transition-colors", active ? "text-red-text" : "text-current")} />
            <span className="w-full text-center leading-[1.15] hyphens-auto">{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile: a thumb-reachable tab bar pinned to the bottom, clear of the home indicator. */
export function TabBar({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((n) => {
          const active = isActive(path, n.href, exactFor(n.href));
          return (
            <li key={n.href} className="flex-1">
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors",
                  active ? "text-ink" : "text-muted",
                )}
              >
                <span className={cx("grid h-7 w-12 place-items-center rounded-[9px] transition-colors", active && "bg-blush-100")}>
                  <Icon name={n.icon} size={19} className="text-current" />
                </span>
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      aria-label="Sign out"
      title="Sign out"
      className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-blush-50 hover:text-red-text"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      <Icon name="sign-out" size={20} className="text-current" />
    </button>
  );
}
