"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AmbientOrb } from "@/components/ambient-orb";
import { Icon, Logo, cx } from "@/components/ui";

export const FLOW_STEPS = [
  { slug: "profile", label: "Profile" },
  { slug: "voice", label: "Your voice" },
  { slug: "persona", label: "Persona" },
  { slug: "tone", label: "Tone check" },
  { slug: "cadence", label: "Cadence" },
  { slug: "whatsapp", label: "WhatsApp" },
] as const;

/**
 * Segmented progress. The chevrons it replaces were a deck diagram pressed into
 * service as navigation: they forced every label to compete at equal weight and
 * broke down the moment one wrapped. A rail states position in one glance and
 * stays legible at any width — only the current step is named.
 */
function FlowProgress({ current, reached }: { current: number; reached: number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-[13px] font-semibold text-ink">{FLOW_STEPS[current - 2]?.label}</span>
        <span className="flex-none text-[11px] tracking-[0.06em] text-muted tabular-nums uppercase">
          Step {current - 1} of {FLOW_STEPS.length}
        </span>
      </div>
      <ol className="flex gap-1" aria-label="Setup progress">
        {FLOW_STEPS.map((s, i) => {
          const step = i + 2;
          const done = step < reached;
          const active = step === current;
          const body = (
            <span
              className={cx(
                "block h-[3px] rounded-full transition-colors duration-300",
                active ? "bg-red" : done ? "bg-blush-300" : "bg-[rgba(255,255,255,0.1)]",
              )}
            />
          );
          return (
            <li key={s.slug} className="min-w-0 flex-1" aria-current={active ? "step" : undefined}>
              {step < reached ? (
                <Link
                  href={`/onboarding/${s.slug}`}
                  aria-label={`Back to ${s.label}`}
                  className="block rounded-full py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red"
                >
                  {body}
                </Link>
              ) : (
                <span className="block py-2">
                  <span className="sr-only">{s.label}</span>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * One frame for the whole journey. Sign-in, sign-up and every setup step share
 * it so the experience reads as a single continuous surface rather than six
 * pages that happen to be dark. The orb sits behind the content as ambient
 * light; `level` makes it react while the mic is open.
 */
export function FlowShell({
  children,
  current,
  reached,
  name,
  level = 0,
  orb = "ambient",
  footer,
  onBack,
}: {
  children: ReactNode;
  current?: number;
  reached?: number;
  name?: string;
  level?: number;
  orb?: "ambient" | "hidden";
  footer?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--bg)]">
      {orb === "ambient" && <AmbientOrb level={level} />}

      <header className="relative z-10 flex flex-none items-center gap-4 px-4 pt-4 pb-1 sm:px-8 sm:pt-6">
        {onBack ? (
          <button
            onClick={onBack}
            aria-label="Back"
            className="grid h-11 w-11 flex-none place-items-center rounded-full text-muted transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-ink focus-visible:ring-2 focus-visible:ring-red focus-visible:outline-none"
          >
            <Icon name="caret-left" size={20} className="text-current" />
          </button>
        ) : (
          <Logo height={22} />
        )}
        {current && reached ? <FlowProgress current={current} reached={reached} /> : <div className="flex-1" />}
        {name && <span className="hidden flex-none text-[12px] text-muted sm:block">{name}</span>}
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 sm:px-8">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">{children}</div>
      </main>

      {footer && (
        <footer
          className="relative z-10 flex-none border-t border-line bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] px-4 py-3 backdrop-blur-xl sm:px-8"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto w-full max-w-xl">{footer}</div>
        </footer>
      )}
    </div>
  );
}
