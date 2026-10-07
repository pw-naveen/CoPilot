import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
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
export function Logo({ variant = "color", height = 28 }: { variant?: "color" | "reverse" | "white" | "mark"; height?: number }) {
  const src = variant === "mark" ? "/brand/pulseworks-mark-color.png" : `/brand/pulseworks-lockup-${variant}.png`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Pulseworks" style={{ height, width: "auto" }} />;
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
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div className="flex max-w-3xl flex-col gap-4">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <TwoToneTitle lead={lead} accent={accent} />
        {intro && <p className="lead max-w-2xl">{intro}</p>}
      </div>
      {actions && <div className="flex gap-3">{actions}</div>}
    </header>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
const btn = (v: BtnVariant, size: "md" | "sm") =>
  cx(
    "inline-flex items-center justify-center gap-2 rounded-[16px] font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none select-none",
    size === "md" ? "h-11 px-5 text-[15px]" : "h-9 px-4 text-[13px]",
    v === "primary" && "bg-red text-white hover:bg-red-dark active:bg-red-dark",
    v === "secondary" && "bg-white text-ink shadow-card hover:text-red-text",
    v === "ghost" && "text-red-text hover:text-red-dark hover:bg-blush-50",
    v === "danger" && "bg-white text-red-text shadow-card hover:bg-blush-50",
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
    <div {...p} className={cx("card p-6", className)}>
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

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      {children}
      {hint && !error && <span className="text-[12px] text-muted">{hint}</span>}
      {error && <span className="text-[12px] font-medium text-red-text">{error}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-[16px] bg-white px-4 text-[15px] text-ink placeholder:text-graphite-500 ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-red";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputCls, "h-11", props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputCls, "min-h-28 py-3 leading-relaxed", props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputCls, "h-11 appearance-none pr-10", props.className)} />;
}

export const STATUS_LABEL: Record<string, string> = {
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
  paused: "Paused",
};

/** Blush tints deepen as a post moves toward approval; red is reserved for the end states. */
export function StatusPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    awaiting_input: "bg-blush-50 text-muted",
    drafting: "bg-blush-100 text-ink-soft",
    pending_approval: "bg-blush-200 text-ink",
    changes_requested: "bg-blush-200 text-ink",
    approved: "bg-red text-white",
    missed: "bg-white text-red-text ring-1 ring-red",
    skipped: "bg-white text-muted ring-1 ring-graphite-300",
    invited: "bg-blush-50 text-muted",
    onboarding: "bg-blush-100 text-ink-soft",
    active: "bg-red text-white",
    paused: "bg-white text-muted ring-1 ring-graphite-300",
  };
  return (
    <span className={cx("inline-flex h-6 items-center rounded-[16px] px-2.5 text-[12px] font-semibold whitespace-nowrap", cls[status])}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[12px] font-bold uppercase tracking-[0.02em] text-ink">{children}</span>;
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
