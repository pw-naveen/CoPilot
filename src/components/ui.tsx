import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { ICON_PATHS, type IconName } from "./icon-paths";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

/** Phosphor Light glyph. Colour comes from CSS `color` (red by default). */
export function Icon({ name, size = 20, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      className={cx("inline-block flex-none", className ?? "text-red")}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
    />
  );
}

/** Supplied lockup, used as-is (never redrawn or recoloured). */
/**
 * The product mark. CoPilot's lockup is a white wordmark with the red monogram,
 * drawn for dark grounds — which is every surface the app has. There is no
 * dark-text variant, so a light surface would need one commissioned rather than
 * recoloured. `pulseworks` stays for the places the parent brand is the point.
 */
const LOGOS = {
  lockup: { src: "/brand/copilot-lockup-white.png", alt: "CoPilot", ratio: 793 / 248 },
  mark: { src: "/brand/copilot-mark.png", alt: "CoPilot", ratio: 146 / 176 },
  pulseworks: { src: "/brand/pulseworks-lockup-reverse.png", alt: "Pulseworks", ratio: 0 },
  "pulseworks-mark": { src: "/brand/pulseworks-mark-white.png", alt: "Pulseworks", ratio: 0 },
} as const;

export function Logo({ variant = "lockup", height = 28 }: { variant?: keyof typeof LOGOS; height?: number }) {
  const l = LOGOS[variant];
  // Width from the intrinsic ratio so the row reserves the right space before
  // the image loads, instead of reflowing once it does.
  const width = l.ratio ? Math.round(height * l.ratio) : undefined;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={l.src} alt={l.alt} width={width} height={height} style={{ height, width: width ?? "auto" }} />;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="eyebrow">
      <span>{children}</span>
      <svg width="30" height="8" viewBox="0 0 44 10" aria-hidden="true">
        <path d="M0 5h42M37 1l5 4-5 4" stroke="var(--red)" fill="none" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/** Setup in ink, payoff in red. Headlines are claims, not topics. */
export function TwoToneTitle({
  lead,
  accent,
  hero,
  rule = true,
  as: Tag = "h1",
}: {
  lead: string | string[];
  accent?: string | string[];
  hero?: boolean;
  rule?: boolean;
  as?: "h1" | "h2";
}) {
  const L = ([] as string[]).concat(lead);
  const A = ([] as string[]).concat(accent ?? []);
  return (
    <div className="flex flex-col gap-4">
      <Tag className={cx("title", hero && "title-hero")}>
        {L.map((t, i) => (
          <span key={`l${i}`}>{t}</span>
        ))}
        {A.map((t, i) => (
          <span key={`a${i}`} className="accent">
            {t}
          </span>
        ))}
      </Tag>
      {rule && <hr className="rule" />}
    </div>
  );
}

/**
 * Page header for a product surface. The deck's two-tone uppercase hero is a
 * headline for an argument; a tool wants a label. The same `lead` + `accent`
 * pair now sets one sentence-case line with the payoff in red, so every page
 * keeps the brand's cadence at a size that doesn't shout at someone using it
 * forty times a day.
 */
export function PageHeader({
  eyebrow,
  lead,
  accent,
  intro,
  actions,
}: {
  eyebrow?: string;
  lead: string | string[];
  accent?: string | string[];
  intro?: ReactNode;
  actions?: ReactNode;
}) {
  const join = (v?: string | string[]) => (Array.isArray(v) ? v.join(" ") : v);
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-line pb-6">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1.5">
        {eyebrow && (
          <span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">
            <span className="h-px w-5 bg-red" aria-hidden />
            {eyebrow}
          </span>
        )}
        <h1 className="text-[23px] leading-tight font-semibold tracking-[-0.02em] text-balance text-ink">
          {join(lead)} {accent && <span className="text-red-text">{join(accent)}</span>}
        </h1>
        {intro && <p className="max-w-2xl text-[14px] leading-relaxed text-muted">{intro}</p>}
      </div>
      {actions && <div className="flex flex-none gap-2">{actions}</div>}
    </header>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
const btn = (v: BtnVariant, size: "md" | "sm") =>
  cx(
    "inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold tracking-[-0.005em] select-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-40",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
    size === "md" ? "h-10 px-4 text-[14px]" : "h-8 px-3 text-[13px]",
    // A flat fill reads as a sticker; the inset highlight gives the accent a lit top edge.
    v === "primary" &&
      "bg-red text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(0,0,0,0.4)] hover:bg-[#f22a32] active:bg-red-dark",
    v === "secondary" &&
      "border border-line bg-surface-raised text-ink hover:border-line-strong hover:bg-[#232327]",
    v === "ghost" && "text-ink-soft hover:bg-blush-50 hover:text-red-text",
    v === "danger" && "border border-blush-200 bg-blush-50 text-red-text hover:bg-blush-100",
  );

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: BtnVariant; size?: "md" | "sm" }) {
  return <button {...props} className={cx(btn(variant, size), className)} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: "md" | "sm" }) {
  return <Link {...props} className={cx(btn(variant, size), className)} />;
}

export function Card({ className, children, ...p }: ComponentProps<"div">) {
  return (
    <div {...p} className={cx("card p-5", className)}>
      {children}
    </div>
  );
}

export function Statement({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("statement px-6 py-5", className)}>{children}</div>;
}

/** 48px blush circle with a red glyph (the deck's 96px icon circle, at app scale). */
export function IconCircle({ name, solid, size = 48 }: { name: IconName; solid?: boolean; size?: number }) {
  return (
    <span
      className={cx("grid flex-none place-items-center rounded-full", solid ? "bg-red shadow-disc" : "bg-blush-100")}
      style={{ width: size, height: size }}
    >
      <Icon name={name} size={Math.round(size / 2)} className={solid ? "text-white" : "text-red"} />
    </span>
  );
}

/**
 * Pass `htmlFor` when the field holds anything focusable besides the control
 * itself (a show-password toggle, a unit button). An implicit label wraps those
 * extras into the input's accessible name and steals their clicks, so the field
 * renders as a plain div and associates the label explicitly instead.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  const Wrapper = htmlFor ? "div" : "label";
  return (
    <Wrapper className="flex flex-col gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink">
          {label}
        </label>
      ) : (
        <span className="text-[13px] font-semibold text-ink">{label}</span>
      )}
      {children}
      {hint && !error && <span className="text-[12px] text-muted">{hint}</span>}
      {error && <span className="text-[12px] font-medium text-red-text">{error}</span>}
    </Wrapper>
  );
}

const inputCls =
  cx(
    "w-full rounded-[10px] border border-line bg-surface-input px-3 text-[14px] text-ink",
    "placeholder:text-graphite-700 transition-[border-color,box-shadow] duration-150",
    "hover:border-line-strong focus:border-red/70 focus:outline-none focus:ring-[3px] focus:ring-red/20",
  );

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputCls, "h-10", props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputCls, "min-h-28 py-2.5 leading-relaxed", props.className)} />;
}

/**
 * `appearance-none` removes the browser's own arrow, so the control has to draw
 * one: without it a select is indistinguishable from a text input.
 */
export function Select({ className, ...props }: ComponentProps<"select">) {
  // `className` sizes the wrapper, not the select: the caret is positioned
  // against the wrapper, so a width on the inner element would strand it.
  return (
    <span className={cx("relative block", className)}>
      <select {...props} className={cx(inputCls, "h-10 w-full appearance-none pr-9")} />
      <Icon
        name="caret-down"
        size={16}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted"
      />
    </span>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting approval",
  rejected: "Not approved",
  awaiting_input: "Awaiting input",
  drafting: "Drafting",
  pending_approval: "Pending approval",
  changes_requested: "Changes requested",
  approved: "Approved",
  missed: "Missed",
  skipped: "Skipped",
  invited: "Invited",
  onboarding: "Onboarding",
  active: "Active",
  paused: "Suspended",
};

/** Blush tints deepen as a post moves toward approval; red is reserved for the end states. */
export function StatusPill({ status }: { status: string }) {
  // Quiet states sit in tint, states needing attention gain an outline, and only
  // a finished state earns the solid accent — so one glance ranks a list.
  const cls: Record<string, string> = {
    pending: "border-blush-300 bg-blush-100 text-red-text",
    rejected: "border-line bg-surface-raised text-muted",
    awaiting_input: "border-line bg-surface-raised text-muted",
    drafting: "border-line-strong bg-surface-raised text-ink-soft",
    pending_approval: "border-blush-300 bg-blush-100 text-red-text",
    changes_requested: "border-blush-300 bg-blush-100 text-red-text",
    approved: "border-transparent bg-red text-white",
    missed: "border-red bg-blush-50 text-red-text",
    skipped: "border-line bg-transparent text-graphite-700",
    invited: "border-line bg-surface-raised text-muted",
    onboarding: "border-line-strong bg-surface-raised text-ink-soft",
    active: "border-transparent bg-red text-white",
    paused: "border-line bg-transparent text-muted",
  };
  return (
    <span
      className={cx(
        "inline-flex h-[22px] items-center rounded-full border px-2.5 text-[11px] font-semibold tracking-[0.01em] whitespace-nowrap",
        cls[status],
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{children}</span>;
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <IconCircle name={icon} />
      <p className="card-title">{title}</p>
      {children && <p className="max-w-md text-muted">{children}</p>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "alert"; children: ReactNode }) {
  return (
    <div className={cx("flex items-start gap-3 rounded-[16px] px-4 py-3 text-[14px]", tone === "alert" ? "bg-blush-100 text-ink" : "bg-blush-50 text-ink-soft")}>
      <Icon name={tone === "alert" ? "warning-circle" : "info"} size={20} className="mt-px text-red" />
      <div>{children}</div>
    </div>
  );
}

/**
 * Circular progress. `value` and `max` are counts, not percentages, so the ring
 * and the "3 of 12" label can never disagree.
 */
export function ProgressRing({
  value,
  max,
  size = 56,
  stroke = 5,
  children,
  className,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <span
      className={cx("relative grid flex-none place-items-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={`${value} of ${max} answered`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--blush-100)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--red)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 500ms cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <span className="absolute grid place-items-center text-[12px] font-bold text-ink tabular-nums">{children}</span>
    </span>
  );
}

/**
 * The assistant orb. `level` (0–1) drives the glow and scale, so the same
 * component reads as idle on a hero and as live while the mic is open.
 */
export function Orb({ size = 96, level = 0, icon, className }: { size?: number; level?: number; icon?: IconName; className?: string }) {
  const l = Math.min(1, Math.max(0, level));
  return (
    <span className={cx("relative grid flex-none place-items-center", className)} style={{ width: size, height: size }}>
      <span className="orb-halo" aria-hidden />
      <span className="orb-ring" aria-hidden />
      <span className="orb grid h-full w-full place-items-center" style={{ "--orb-level": l } as CSSProperties} aria-hidden>
        <span className="orb-core" />
        {icon && <Icon name={icon} size={Math.round(size / 2.8)} className="relative z-[1] text-white" />}
      </span>
    </span>
  );
}

/**
 * Stat tile. Label in sentence case, value semibold in proportional figures —
 * `tabular-nums` is for columns that must align, and at display sizes it makes
 * a number like 121 look loose. `tone` ships with its own icon and label so the
 * state is never carried by colour alone.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "neutral" | "attention";
  icon?: IconName;
  href?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5">
        {icon && <Icon name={icon} size={14} className={tone === "attention" ? "text-red-text" : "text-graphite-700"} />}
        <span className="text-[11px] leading-tight font-medium text-muted sm:text-[12px]">{label}</span>
      </span>
      <span className={cx("text-[26px] leading-none font-semibold tracking-[-0.02em] sm:text-[30px]", tone === "attention" ? "text-red-text" : "text-ink")}>
        {value}
      </span>
      {hint && <span className="hidden text-[12px] text-graphite-700 sm:block">{hint}</span>}
    </>
  );
  const cls = cx(
    "flex min-w-0 flex-col gap-2 rounded-[16px] border p-4 transition-colors",
    tone === "attention" ? "border-blush-300 bg-blush-50" : "border-line bg-surface",
    href && "hover:border-line-strong",
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
