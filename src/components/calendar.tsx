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

/** Week-by-week calendar: each slot shows its status and approval deadline; at-risk slots are flagged. */
export function Calendar({ slots, tz, now, postHref }: { slots: CalSlot[]; tz: string; now: Date; postHref: (postId: string) => string }) {
  if (!slots.length) return null;
  const weeks = new Map<string, CalSlot[]>();
  for (const s of slots) {
    const k = DateTime.fromJSDate(s.publishAt, { zone: tz }).startOf("week").toISODate()!;
    weeks.set(k, [...(weeks.get(k) ?? []), s]);
  }
  const today = DateTime.fromJSDate(now, { zone: tz }).toISODate();
  return (
    <div className="flex flex-col gap-8">
      {[...weeks.entries()].map(([wk, list]) => {
        const start = DateTime.fromISO(wk, { zone: tz });
        return (
          <section key={wk}>
            <h3 className="mb-3 text-[13px] font-semibold text-muted">
              Week of {start.toFormat("d LLL")}
              {start <= DateTime.fromJSDate(now, { zone: tz }) && start.plus({ weeks: 1 }) > DateTime.fromJSDate(now, { zone: tz }) && <span className="ml-2 text-red-text">This week</span>}
            </h3>
            <div className="grid gap-3 md:grid-cols-7">
              {Array.from({ length: 7 }, (_, i) => {
                const day = start.plus({ days: i });
                const items = list.filter((s) => DateTime.fromJSDate(s.publishAt, { zone: tz }).hasSame(day, "day"));
                return (
                  <div key={i} className={cx("min-h-24 rounded-[16px] p-2", items.length ? "bg-white shadow-card" : "hidden bg-blush-50/60 md:block")}>
                    <p className={cx("mb-2 px-1 text-[12px] font-semibold", day.toISODate() === today ? "text-red-text" : "text-muted")}>
                      {day.toFormat("ccc d")}
                    </p>
                    {items.map((s) => (
                      <SlotCard key={s.id} s={s} tz={tz} now={now} href={s.post ? postHref(s.post.id) : undefined} />
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SlotCard({ s, tz, now, href }: { s: CalSlot; tz: string; now: Date; href?: string }) {
  const risk = isAtRisk(s, now);
  const body = (
    <div className={cx("flex flex-col gap-1.5 rounded-[12px] px-2 py-2", href && "hover:bg-blush-50", risk && "ring-1 ring-red")}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[13px] font-semibold text-ink">{DateTime.fromJSDate(s.publishAt, { zone: tz }).toFormat("HH:mm")}</span>
        {risk && <Icon name="warning" size={16} className="text-red" label="At risk" />}
      </div>
      <StatusPill status={s.status} />
      {s.post?.summary && <p className="line-clamp-2 text-[12px] text-ink-soft">{s.post.summary}</p>}
      {!s.post && s.status === "awaiting_input" && <p className="text-[12px] text-muted">Send a topic on WhatsApp</p>}
      {s.post?.suggestedTopic && <p className="text-[11px] font-semibold text-red-text">Suggested topic</p>}
      {s.isExtra && <p className="text-[11px] text-muted">Extra post</p>}
      {!["approved", "missed", "skipped"].includes(s.status) && (
        <p className="text-[11px] text-muted">Approve by {DateTime.fromJSDate(s.approvalDeadline, { zone: tz }).toFormat("ccc d LLL, HH:mm")}</p>
      )}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
