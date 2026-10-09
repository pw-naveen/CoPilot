import Link from "next/link";
import { DateTime } from "luxon";
import { staffActor } from "@/server/page-auth";
import { CRITICAL_DAYS, QUIET_DAYS, dashboardTotals, postingHealth, recentPosts } from "@/server/services/dashboard";
import { Card, EmptyState, Icon, PageHeader, StatTile, StatusPill, cx } from "@/components/ui";
import { HealthPill } from "./health-pill";

export const dynamic = "force-dynamic";

/**
 * The health of the whole book, which is a different question from the board's
 * "what is on my desk today". The one number that matters is how long it has
 * been since each person actually published, because an account can look busy
 * — a full calendar, drafts written — and still have gone silent.
 */
export default async function Overview() {
  const actor = await staffActor();
  const [totals, health, recent] = await Promise.all([dashboardTotals(actor), postingHealth(actor), recentPosts(actor)]);
  const critical = health.rows.filter((r) => r.health === "critical");
  const quiet = health.rows.filter((r) => r.health === "quiet");
  const peak = Math.max(1, ...health.weeks.map((w) => w.count));

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        lead="Who's posting,"
        accent="and who's gone quiet."
        intro={`An account is critical once ${CRITICAL_DAYS} days pass without a post going out, and quiet after ${QUIET_DAYS}.`}
      />

      <div className="mb-8 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatTile
          label="Critical"
          value={critical.length}
          tone={critical.length ? "attention" : "neutral"}
          icon={critical.length ? "warning" : "check-circle"}
          hint={`No post in ${CRITICAL_DAYS} days`}
        />
        <StatTile label="Quiet" value={quiet.length} icon="clock" hint={`No post in ${QUIET_DAYS} days`} />
        <StatTile
          label="Waiting on approval"
          value={totals.waiting}
          tone={totals.atRisk ? "attention" : "neutral"}
          icon="clock-counter-clockwise"
          hint={totals.atRisk ? `${totals.atRisk} inside 72 hours` : "None inside 72 hours"}
          href="/admin/board"
        />
        <StatTile label="Live accounts" value={totals.live} icon="users-three" hint={summarise(totals)} href="/admin/users" />
      </div>

      {totals.pending > 0 && (
        <Link
          href="/admin/users"
          className="mb-8 flex items-center gap-3 rounded-[16px] border border-blush-300 bg-blush-50 px-5 py-4 text-[14px]"
        >
          <Icon name="user-circle" size={18} className="flex-none text-red-text" />
          <span className="min-w-0 flex-1 text-ink">
            <span className="font-semibold">{totals.pending}</span> registration{totals.pending > 1 ? "s" : ""} waiting for your
            approval
          </span>
          <Icon name="caret-right" size={16} className="flex-none text-red-text" />
        </Link>
      )}

      <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <h2 className="mb-3 px-1 text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">Posting health</h2>
          <Card className="p-0">
            {health.rows.length === 0 ? (
              <EmptyState icon="users-three" title="No live accounts yet">
                Accounts appear here once they finish setup.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {health.rows.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/admin/users/${r.id}`}
                      className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-[rgba(255,255,255,0.03)] sm:px-5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-[14px] font-semibold text-ink">{r.name}</span>
                          <HealthPill health={r.health} />
                          {r.status === "paused" && <StatusPill status="paused" />}
                        </span>
                        <span className="mt-1 block text-[13px] text-muted">
                          {r.lastPostedAt
                            ? `Last post ${DateTime.fromJSDate(r.lastPostedAt).toFormat("d LLL")} · ${r.daysSince} days ago`
                            : `Never posted · live ${r.daysSince} days`}
                          {r.waiting > 0 && ` · ${r.waiting} waiting on them`}
                          {r.missed > 0 && ` · ${r.missed} missed`}
                        </span>
                      </span>
                      <span className="hidden text-right sm:block">
                        <span className="block text-[17px] font-semibold text-ink tabular-nums">{r.postedLast30}</span>
                        <span className="block text-[11px] text-graphite-700">in 30 days</span>
                      </span>
                      <Icon name="caret-right" size={16} className="flex-none text-graphite-500" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 px-1 text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">Posts published</h2>
            <Card className="flex flex-col gap-4">
              {/* Eight weeks of volume. One series, so the heading names it and
                  no legend is needed; only the ends of the range are labelled. */}
              <ul className="flex h-28 items-end gap-1.5">
                {health.weeks.map((w, i) => (
                  <li key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <span className="text-[11px] text-graphite-700 tabular-nums">{w.count || ""}</span>
                    <span
                      className={cx("w-full rounded-t-[4px]", i === health.weeks.length - 1 ? "bg-red" : "bg-blush-300")}
                      style={{ height: `${Math.max(w.count ? 6 : 2, (w.count / peak) * 76)}px` }}
                      aria-hidden
                    />
                    <span className="sr-only">
                      Week of {DateTime.fromJSDate(w.from).toFormat("d LLL")}: {w.count}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex items-baseline justify-between text-[11px] text-graphite-700">
                <span>{DateTime.fromJSDate(health.weeks[0].from).toFormat("d LLL")}</span>
                <span>This week</span>
              </div>
            </Card>
          </section>

          <section>
            <h2 className="mb-3 px-1 text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">Latest drafts</h2>
            <Card className="p-0">
              {recent.length === 0 ? (
                <EmptyState icon="note-pencil" title="Nothing drafted yet" />
              ) : (
                <ul className="divide-y divide-line">
                  {recent.map((p) => (
                    <li key={p.id}>
                      <Link href={`/admin/posts/${p.id}`} className="block px-5 py-3 transition-colors hover:bg-[rgba(255,255,255,0.03)]">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-ink">{p.user.name}</span>
                          <StatusPill status={p.status} />
                        </span>
                        {p.summary && <span className="mt-1 line-clamp-1 text-[13px] text-muted">{p.summary}</span>}
                        {p.flagged && <span className="mt-1 block text-[12px] font-semibold text-red-text">Held for review</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}

function summarise(t: Awaited<ReturnType<typeof dashboardTotals>>) {
  const parts = [];
  if (t.settingUp) parts.push(`${t.settingUp} setting up`);
  if (t.suspended) parts.push(`${t.suspended} suspended`);
  return parts.join(" · ") || "All set up";
}
