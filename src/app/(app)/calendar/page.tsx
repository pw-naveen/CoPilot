import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { now } from "@/server/clock";
import { userActor } from "@/server/page-auth";
import { isAtRisk } from "@/server/schedule";
import { currentCadence, listSlots } from "@/server/services/cadence";
import { Calendar } from "@/components/calendar";
import { CadenceEditor } from "@/components/cadence-editor";
import { Card, EmptyState, Icon, Notice, PageHeader, StatTile } from "@/components/ui";

export const dynamic = "force-dynamic";

const NEEDS_YOU = ["pending_approval", "changes_requested"];

export default async function CalendarPage() {
  const actor = await userActor();
  const u = (await db.query.users.findFirst({ where: eq(schema.users.id, actor.id) }))!;
  const [slots, cadence, at] = await Promise.all([listSlots(actor, actor.id), currentCadence(actor.id), now()]);

  // What the page is actually for: how much is waiting on this person.
  const needsYou = slots.filter((s) => NEEDS_YOU.includes(s.status));
  const atRisk = needsYou.filter((s) => isAtRisk(s, at));
  const scheduled = slots.filter((s) => !["approved", "missed", "skipped"].includes(s.status));
  const approved = slots.filter((s) => s.status === "approved");

  return (
    <>
      <PageHeader
        eyebrow="Calendar"
        lead="Every slot,"
        accent="approved in time."
        intro="Each post needs your approval 48 hours before it goes out."
      />

      {u.status === "paused" && (
        <div className="mb-6">
          <Notice tone="alert">Your account is paused. No reminders or drafts are being sent.</Notice>
        </div>
      )}

      {slots.length ? (
        <>
          <div className="mb-8 grid grid-cols-3 gap-2.5 sm:gap-3">
            <StatTile
              label="Waiting on you"
              value={needsYou.length}
              tone={needsYou.length ? "attention" : "neutral"}
              icon={needsYou.length ? "warning" : "check-circle"}
              hint={atRisk.length ? `${atRisk.length} inside 72 hours` : needsYou.length ? "Nothing urgent yet" : "You're all caught up"}
            />
            <StatTile label="Scheduled" value={scheduled.length} hint="Slots still to come" icon="calendar-check" />
            <StatTile label="Approved" value={approved.length} hint="Ready to publish" icon="seal-check" />
          </div>

          {needsYou.length > 0 && (
            <section className="mb-9">
              <h2 className="mb-2 flex items-center gap-2 px-1 text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">
                <Icon name="warning" size={13} className="text-red-text" />
                Waiting on you
              </h2>
              <Calendar slots={needsYou} tz={u.timezone} now={at} postHref={(id) => `/posts/${id}`} />
            </section>
          )}

          <section>
            <h2 className="mb-3 px-1 text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">Everything scheduled</h2>
            <Calendar slots={slots} tz={u.timezone} now={at} postHref={(id) => `/posts/${id}`} />
          </section>
        </>
      ) : (
        <Card>
          <EmptyState icon="calendar-blank" title="No slots yet">
            Slots appear here once your cadence is set and WhatsApp is connected.
          </EmptyState>
        </Card>
      )}

      {/* Settings, not the main event: available without competing with the agenda. */}
      <details className="group mt-10 rounded-[16px] border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 focus-visible:ring-2 focus-visible:ring-red focus-visible:outline-none">
          <Icon name="gear" size={17} className="flex-none text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-ink">Posting cadence</span>
            <span className="block text-[13px] text-muted">
              {cadence ? `${cadence.postsPerWeek} a week` : "Not set"} · only future, unstarted posts move
            </span>
          </span>
          <Icon name="caret-down" size={16} className="flex-none text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-line p-5">
          <CadenceEditor
            userId={actor.id}
            timezone={u.timezone}
            initial={cadence ? { postsPerWeek: cadence.postsPerWeek, weekdays: cadence.weekdays, times: cadence.times } : null}
          />
        </div>
      </details>
    </>
  );
}
