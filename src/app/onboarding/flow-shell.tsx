"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AmbientOrb } from "@/components/ambient-orb";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonLink, Icon, Logo, cx } from "@/components/ui";

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
                active ? "bg-red" : done ? "bg-blush-300 group-hover:bg-red" : "bg-[rgba(255,255,255,0.1)]",
              )}
            />
          );
          return (
            <li key={s.slug} className="min-w-0 flex-1" aria-current={active ? "step" : undefined}>
              {step < reached ? (
                <Link
                  href={`/onboarding/${s.slug}`}
                  aria-label={`Back to ${s.label}`}
                    title={`Back to ${s.label}`}
                  className="group block rounded-full py-2 focus-visible:ring-2 focus-visible:ring-red focus-visible:outline-none"
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
/**
 * Moving between steps that are already done. Without this the rail is the only
 * way back and the only way forward is finishing the current step, which leaves
 * someone reviewing an earlier step with no exit at all.
 */
function StepNav({ current, reached }: { current: number; reached: number }) {
  const prev = current > 2 ? FLOW_STEPS[current - 3] : null;
  const next = current < reached ? FLOW_STEPS[current - 1] : null;
  const behind = current < reached;
  return (
    <div className="flex items-center gap-2">
      {prev ? (
        <ButtonLink href={`/onboarding/${prev.slug}`} size="sm" variant="secondary">
          <Icon name="caret-left" size={15} className="text-current" />
          <span className="hidden sm:inline">{prev.label}</span>
          <span className="sm:hidden">Back</span>
        </ButtonLink>
      ) : (
        <span />
      )}
      <div className="flex-1" />
      {behind && (
        <ButtonLink href={`/onboarding/${FLOW_STEPS[reached - 2].slug}`} size="sm" variant="ghost">
          Resume setup
        </ButtonLink>
      )}
      {next && (
        <ButtonLink href={`/onboarding/${next.slug}`} size="sm">
          <span className="hidden sm:inline">{next.label}</span>
          <span className="sm:hidden">Next</span>
          <Icon name="caret-right" size={15} className="text-current" />
        </ButtonLink>
      )}
    </div>
  );
}

/**
 * Setup cannot be skipped to the end: an account only goes active once WhatsApp
 * verification lands, and drafting needs the persona built in step 3. So the
 * honest exit is leaving and coming back, which this says plainly rather than
 * offering a "skip" that would strand the account half-built.
 */
function FinishLater() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        router.replace("/login");
        router.refresh();
      }}
      className="rounded-[10px] px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-red focus-visible:outline-none disabled:opacity-50"
    >
      {busy ? "Saving…" : "Finish later"}
    </button>
  );
}

export function FlowShell({
  children,
  current,
  reached,
  name,
  level = 0,
  orb = "ambient",
  footer,
  onBack,
  reviewOnly,
}: {
  children: ReactNode;
  current?: number;
  reached?: number;
  name?: string;
  level?: number;
  orb?: "ambient" | "hidden";
  footer?: ReactNode;
  onBack?: () => void;
  reviewOnly?: boolean;
}) {
  // Every step keeps a way out; a review-only step also gets prev/next.
  const nav = current && reached ? <StepNav current={current} reached={reached} /> : null;
  const resolvedFooter = footer ?? (reviewOnly ? nav : null);
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--bg)]">
      {orb === "ambient" && <AmbientOrb level={level} />}

      {/* Two rows, not one. Brand and account are chrome; the step and its
          progress are content, and crowding them onto the logo line made the
          rail compete with the exit control for the same eye. */}
      <header className="relative z-10 flex-none">
        <div className="flex items-center gap-4 px-4 pt-4 sm:px-8 sm:pt-5">
          {onBack ? (
            <button
              onClick={onBack}
              aria-label="Back"
              className="-ml-2 grid h-11 w-11 flex-none place-items-center rounded-full text-muted transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-ink focus-visible:ring-2 focus-visible:ring-red focus-visible:outline-none"
            >
              <Icon name="caret-left" size={20} className="text-current" />
            </button>
          ) : (
            <Logo height={34} />
          )}
          <div className="flex-1" />
          <div className="flex flex-none items-center gap-4">
            {name && <span className="hidden text-[12px] text-muted sm:block">{name}</span>}
            <FinishLater />
          </div>
        </div>
        {current && reached ? (
          <div className="px-4 pt-3 sm:px-8">
            <div className="mx-auto w-full max-w-xl">
              <FlowProgress current={current} reached={reached} />
            </div>
          </div>
        ) : null}
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 sm:px-8">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">{children}</div>
      </main>

      {resolvedFooter && (
        <footer
          className="relative z-10 flex-none border-t border-line bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] px-4 py-3 backdrop-blur-xl sm:px-8"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto w-full max-w-xl">{resolvedFooter}</div>
        </footer>
      )}
    </div>
  );
}
