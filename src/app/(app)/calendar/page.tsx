import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { now } from "@/server/clock";
import { userActor } from "@/server/page-auth";
import { currentCadence, listSlots } from "@/server/services/cadence";
import { Calendar } from "@/components/calendar";
import { CadenceEditor } from "@/components/cadence-editor";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const actor = await userActor();
  const u = (await db.query.users.findFirst({ where: eq(schema.users.id, actor.id) }))!;
  const [slots, cadence, at] = await Promise.all([listSlots(actor, actor.id), currentCadence(actor.id), now()]);
  return (
    <>
      <PageHeader eyebrow="Calendar" lead="Every slot," accent="approved in time." intro="Each post needs your approval 48 hours before it goes out. Slots marked with a warning are inside 72 hours and still need you." />
      {u.status === "paused" && <div className="mb-6"><Notice tone="alert">Your account is paused. No reminders or drafts are being sent.</Notice></div>}
      {slots.length ? (
        <Calendar slots={slots} tz={u.timezone} now={at} postHref={(id) => `/posts/${id}`} />
      ) : (
        <Card><EmptyState icon="calendar-blank" title="No slots yet">Slots appear here once your cadence is set and WhatsApp is connected.</EmptyState></Card>
      )}
      <section className="mt-16">
        <h2 className="card-title mb-4">Change your cadence</h2>
        <CadenceEditor userId={actor.id} timezone={u.timezone} initial={cadence ? { postsPerWeek: cadence.postsPerWeek, weekdays: cadence.weekdays, times: cadence.times } : null} />
      </section>
    </>
  );
}
