import Link from "next/link";
import { DateTime } from "luxon";
import { isAtRisk } from "@/server/schedule";
import { Icon, StatusPill, cx } from "./ui";

export type CalSlot = {
  id: string;
  publishAt: Date;
  approvalDeadline: Date;
  status: string;
  isExtra: boolean;
  post: { id: string; summary: string | null; topic: string | null; suggestedTopic: boolean; flaggedForStaff: boolean } | null;
};

/**
 * An agenda, not a month grid.
 *
 * At two posts a week a 7-column grid is five empty cells out of seven on every
 * row — pages of chrome around a handful of items, and unusable on a phone. A
 * dense dated list shows the same slots in a fraction of the height and reads
 * identically at any width.
 */
export function Calendar({ slots, tz, now, postHref }: { slots: CalSlot[]; tz: string; now: Date; postHref: (postId: string) => string }) {
  if (!slots.length) return null;
  const nowDt = DateTime.fromJSDate(now, { zone: tz });
  // The "send me a topic" nudge is identical on every open slot, so repeating it
  // ten times down the list turns the agenda into wallpaper. Say it once, on the
  // next one up.
  const nextOpen = [...slots].filter((s) => s.status === "awaiting_input").sort((a, b) => +a.publishAt - +b.publishAt)[0]?.id;

  const weeks = new Map<string, CalSlot[]>();
  for (const s of slots) {
    const k = DateTime.fromJSDate(s.publishAt, { zone: tz }).startOf("week").toISODate()!;
    weeks.set(k, [...(weeks.get(k) ?? []), s]);
  }

  return (
    <div className="flex flex-col gap-7">
      {[...weeks.entries()].map(([wk, list]) => {
        const start = DateTime.fromISO(wk, { zone: tz });
        const thisWeek = start <= nowDt && start.plus({ weeks: 1 }) > nowDt;
        return (
          <section key={wk}>
            <div className="mb-2 flex items-baseline gap-2 px-1">
              <h3 className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">
                {thisWeek ? "This week" : `Week of ${start.toFormat("d LLL")}`}
              </h3>
              {thisWeek && <span className="text-[12px] text-graphite-700">{start.toFormat("d LLL")}</span>}
            </div>
            <ul className="overflow-hidden rounded-[16px] border border-line bg-surface">
              {list
                .sort((a, b) => +a.publishAt - +b.publishAt)
                .map((s, i) => (
                  <SlotRow key={s.id} s={s} tz={tz} now={now} first={i === 0} prompt={s.id === nextOpen} href={s.post ? postHref(s.post.id) : undefined} />
                ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SlotRow({ s, tz, now, first, prompt, href }: { s: CalSlot; tz: string; now: Date; first: boolean; prompt: boolean; href?: string }) {
  const risk = isAtRisk(s, now);
  const at = DateTime.fromJSDate(s.publishAt, { zone: tz });
  const today = at.hasSame(DateTime.fromJSDate(now, { zone: tz }), "day");

  const body = (
    <span className={cx("flex items-start gap-4 px-4 py-3.5 transition-colors sm:px-5", href && "hover:bg-[rgba(255,255,255,0.03)]")}>
      {/* Date block: the one column that must align down the list, so tabular. */}
      <span className="w-11 flex-none text-center leading-tight">
        <span className={cx("block text-[11px] font-semibold uppercase", today ? "text-red-text" : "text-graphite-700")}>
          {at.toFormat("ccc")}
        </span>
        <span className="block text-[19px] font-semibold text-ink tabular-nums">{at.toFormat("d")}</span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[14px] font-medium text-ink tabular-nums">{at.toFormat("HH:mm")}</span>
          <StatusPill status={s.status} />
          {risk && (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-text">
              <Icon name="warning" size={13} className="text-current" />
              At risk
            </span>
          )}
          {s.isExtra && <span className="text-[12px] text-graphite-700">Extra</span>}
        </span>
        {s.post?.summary ? (
          <span className="mt-1 line-clamp-2 block text-[13px] text-ink-soft">{s.post.summary}</span>
        ) : s.status === "awaiting_input" && prompt ? (
          <span className="mt-1 block text-[13px] text-muted">Send a topic on WhatsApp, or we'll pick one from your pillars</span>
        ) : null}
        {!["approved", "missed", "skipped"].includes(s.status) && (
          <span className="mt-1 block text-[12px] text-graphite-700">
            Approve by {DateTime.fromJSDate(s.approvalDeadline, { zone: tz }).toFormat("ccc d LLL, HH:mm")}
          </span>
        )}
      </span>

      {href && <Icon name="caret-right" size={16} className="mt-1 flex-none text-graphite-500" />}
    </span>
  );

  return (
    <li className={cx(!first && "border-t border-line")}>
      {href ? (
        <Link href={href} className="block focus-visible:ring-2 focus-visible:ring-red focus-visible:outline-none focus-visible:-outline-offset-2">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
