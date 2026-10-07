import Link from "next/link";
import { Icon, cx } from "@/components/ui";

const LABELS = ["Profile", "Your voice", "Persona", "Tone check", "Cadence", "WhatsApp"];
const SLUGS = ["profile", "voice", "persona", "tone", "cadence", "whatsapp"];
// Blush tints deepen left → right, as in the Pulseworks process chevrons.
const TINTS = ["bg-blush-50", "bg-blush-100", "bg-blush-100", "bg-blush-200", "bg-blush-200", "bg-blush-300"];

/** Steps 2–7. Completed steps link back so the user can review them. */
export function Stepper({ current, reached }: { current: number; reached: number }) {
  return (
    <ol className="mb-12 flex w-full overflow-hidden" aria-label="Setup progress">
      {LABELS.map((label, i) => {
        const step = i + 2;
        const active = step === current;
        const done = step < reached;
        const clip =
          i === 0 ? "polygon(0 0,calc(100% - 14px) 0,100% 50%,calc(100% - 14px) 100%,0 100%)" : "polygon(0 0,calc(100% - 14px) 0,100% 50%,calc(100% - 14px) 100%,0 100%,14px 50%)";
        const inner = (
          <span
            className={cx(
              "flex h-12 items-center justify-center gap-2 px-5 text-[12px] font-semibold whitespace-nowrap sm:text-[13px]",
              active ? "bg-red text-white" : cx(TINTS[i], step <= reached ? "text-ink" : "text-graphite-500"),
            )}
            style={{ clipPath: clip }}
          >
            <span className="hidden sm:inline">{done ? <Icon name="check" size={14} className="text-current" /> : step - 1}</span>
            <span className={cx(!active && "hidden md:inline")}>{label}</span>
          </span>
        );
        return (
          <li key={label} className="-mr-2 min-w-0 flex-1" aria-current={active ? "step" : undefined}>
            {step <= reached && !active ? <Link href={`/onboarding/${SLUGS[i]}`}>{inner}</Link> : inner}
          </li>
        );
      })}
    </ol>
  );
}
