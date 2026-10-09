import { Icon, cx } from "@/components/ui";
import type { IconName } from "@/components/icon-paths";

/**
 * Posting health. Each state carries an icon and a word as well as its colour,
 * so the ranking survives a greyscale print and colour-blind vision.
 */
const STATES: Record<string, { label: string; icon: IconName; cls: string }> = {
  critical: { label: "Critical", icon: "warning", cls: "border-red bg-blush-100 text-red-text" },
  quiet: { label: "Quiet", icon: "clock", cls: "border-blush-300 bg-blush-50 text-red-text" },
  healthy: { label: "Posting", icon: "check-circle", cls: "border-line bg-surface-raised text-muted" },
  new: { label: "New", icon: "sparkle", cls: "border-line bg-surface-raised text-muted" },
};

export function HealthPill({ health }: { health: string }) {
  const s = STATES[health] ?? STATES.healthy;
  return (
    <span
      className={cx(
        "inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11px] font-semibold whitespace-nowrap",
        s.cls,
      )}
    >
      <Icon name={s.icon} size={12} className="text-current" />
      {s.label}
    </span>
  );
}
