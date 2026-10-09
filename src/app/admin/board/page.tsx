import Link from "next/link";
import { DateTime } from "luxon";
import { now } from "@/server/clock";
import { staffActor } from "@/server/page-auth";
import { canAccessUser } from "@/server/scope";
import { listUsers } from "@/server/services/accounts";
import { board } from "@/server/services/posts";
import { Card, EmptyState, Icon, Label, PageHeader, StatusPill, cx } from "@/components/ui";
import { BoardFilters } from "./board-filters";

export const dynamic = "force-dynamic";

const COLUMN_LIMIT = 8;

type Item = Awaited<ReturnType<typeof board>>[number];

const COLUMNS: { title: string; statuses: string[] }[] = [
  { title: "Awaiting input", statuses: ["awaiting_input"] },
  { title: "Being written", statuses: ["drafting", "changes_requested"] },
  { title: "Pending approval", statuses: ["pending_approval"] },
  { title: "Approved", statuses: ["approved"] },
  { title: "Missed or skipped", statuses: ["missed", "skipped"] },
];

export default async function Board({ searchParams }: { searchParams: Promise<{ user?: string; week?: string }> }) {
  const actor = await staffActor();
  const sp = await searchParams;
  const users = await listUsers(actor);
  const userId = sp.user && (await canAccessUser(actor, sp.user)) ? sp.user : undefined;
  const weekStart = sp.week ? DateTime.fromISO(sp.week).startOf("day").toJSDate() : undefined;
  const items = await board(actor, { userId, weekStart });
  const at = await now();
  const risky = items.filter((i) => i.atRisk || i.post?.flagged);
  const weeks = Array.from({ length: 7 }, (_, i) => DateTime.fromJSDate(at).startOf("week").plus({ weeks: i - 1 }));

  return (
    <>
      <PageHeader
        eyebrow="Board"
        lead="Every post," accent="nothing missed."
        intro={actor.role === "admin" ? "All accounts. At-risk slots are inside 72 hours without approval." : "Your assigned accounts. At-risk slots are inside 72 hours without approval."}
        actions={<BoardFilters users={users.map((u) => ({ id: u.id, name: u.displayName }))} weeks={weeks.map((w) => ({ value: w.toISODate()!, label: `Week of ${w.toFormat("d LLL")}` }))} user={userId ?? ""} week={sp.week ?? ""} />}
      />

      {risky.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold uppercase text-red-text">
            <Icon name="warning" size={16} /> Needs attention ({risky.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {risky.map((i) => (
              <BoardCard key={i.slotId} i={i} highlight />
            ))}
          </div>
        </section>
      )}

      {items.length === 0 ? (
        <Card><EmptyState icon="calendar-blank" title="Nothing scheduled in this view" /></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-5">
          {COLUMNS.map((c) => {
            const list = items.filter((i) => c.statuses.includes(i.status));
            return (
              <section key={c.title} className="flex min-w-0 flex-col gap-3">
                <div className="flex items-baseline justify-between px-1">
                  <Label>{c.title}</Label>
                  <span className="text-[12px] text-muted">{list.length}</span>
                </div>
                {list.slice(0, COLUMN_LIMIT).map((i) => (
                  <BoardCard key={i.slotId} i={i} />
                ))}
                {list.length > COLUMN_LIMIT && <p className="px-1 text-[12px] text-muted">+{list.length - COLUMN_LIMIT} more · filter by account or week to see them</p>}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function BoardCard({ i, highlight }: { i: Item; highlight?: boolean }) {
  const when = DateTime.fromJSDate(i.publishAt, { zone: i.user.timezone });
  const href = i.post ? `/admin/posts/${i.post.id}` : `/admin/users/${i.user.id}`;
  return (
    <Link href={href} className={cx("card flex flex-col gap-2 p-4 hover:-translate-y-0.5 transition-transform", highlight && i.atRisk && "ring-1 ring-red")}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[14px] font-semibold text-ink">{i.user.displayName}</span>
        <StatusPill status={i.status} />
      </div>
      <span className="text-[12px] text-muted">
        {when.toFormat("ccc d LLL, HH:mm")} · approve by {DateTime.fromJSDate(i.approvalDeadline, { zone: i.user.timezone }).toFormat("ccc HH:mm")}
      </span>
      {i.post?.summary && <p className="line-clamp-2 text-[13px] text-ink-soft">{i.post.summary}</p>}
      <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
        {i.post?.flagged && <span className="text-red-text">Held for review</span>}
        {i.atRisk && <span className="text-red-text">At risk</span>}
        {i.post?.suggestedTopic && <span className="text-muted">Suggested topic</span>}
        {i.post?.staffApproved && <span className="text-muted">Staff approved</span>}
      </div>
    </Link>
  );
}
