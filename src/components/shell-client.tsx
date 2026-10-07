"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, cx } from "./ui";

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: ReactNode }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
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
