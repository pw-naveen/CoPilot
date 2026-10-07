import Link from "next/link";
import { notFound } from "next/navigation";
import { now } from "@/server/clock";
import { staffActor } from "@/server/page-auth";
import type { Persona } from "@/server/persona-schema";
import { canAccessUser } from "@/server/scope";
import { getUser } from "@/server/services/accounts";
import { currentCadence, listSlots } from "@/server/services/cadence";
import { activePersona } from "@/server/services/persona";
import { thread } from "@/server/services/whatsapp";
import { Calendar } from "@/components/calendar";
import { CadenceEditor } from "@/components/cadence-editor";
import { PersonaEditor } from "@/components/persona-editor";
import { Thread } from "@/components/thread";
import { Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { AccountSettings } from "./account-settings";

export const dynamic = "force-dynamic";

const STEP = ["", "Invite", "Profile", "Voice", "Persona", "Tone check", "Cadence", "WhatsApp"];

export default async function UserDetail({ params }: { params: Promise<{ userId: string }> }) {
  const actor = await staffActor();
  const { userId } = await params;
  if (!(await canAccessUser(actor, userId))) notFound();
  const u = await getUser(actor, userId);
  const [persona, cadence, slots, messages, at] = await Promise.all([activePersona(userId), currentCadence(userId), listSlots(actor, userId), thread(actor, userId, 60), now()]);

  return (
    <>
      <PageHeader eyebrow={[u.title, u.org].filter(Boolean).join(" · ") || "Account"} lead={u.displayName} accent={u.status === "active" ? "is live." : u.status === "paused" ? "is paused." : "is setting up."} />

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <Card>
          <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-[14px]">
            <dt className="text-muted">Status</dt>
            <dd><StatusPill status={u.status} /></dd>
            <dt className="text-muted">Email</dt>
            <dd>{u.email}</dd>
            <dt className="text-muted">WhatsApp</dt>
            <dd>{u.phoneE164} · {u.whatsappVerifiedAt ? "verified" : "not verified"}</dd>
            <dt className="text-muted">Time zone</dt>
            <dd>{u.timezone}</dd>
            <dt className="text-muted">Setup</dt>
            <dd>{u.status === "active" || u.status === "paused" ? "Complete" : `Step ${u.onboardingStep - 1} of 6 · ${STEP[u.onboardingStep]}`}</dd>
            <dt className="text-muted">Audit</dt>
            <dd><Link className="link" href={`/admin/audit?userId=${u.id}`}>View history</Link></dd>
          </dl>
        </Card>
        <AccountSettings userId={u.id} staffApprovalIsFinal={u.staffApprovalIsFinal} status={u.status} canInvite={actor.role === "admin" || actor.canInvite} />
      </div>

      <section className="mt-14">
        <h2 className="card-title mb-4">Calendar</h2>
        {slots.length ? <Calendar slots={slots} tz={u.timezone} now={at} postHref={(id) => `/admin/posts/${id}`} /> : <Card><EmptyState icon="calendar-blank" title="No slots yet" /></Card>}
      </section>

      <section className="mt-14">
        <h2 className="card-title mb-4">Persona {persona && <span className="font-normal text-muted normal-case">· version {persona.version}</span>}</h2>
        {persona ? <PersonaEditor userId={u.id} persona={persona.json as Persona} version={persona.version} /> : <Card><EmptyState icon="user-circle" title="No persona yet">It's built when the user finishes the voice questionnaire.</EmptyState></Card>}
      </section>

      {cadence && (
        <section className="mt-14">
          <h2 className="card-title mb-4">Cadence</h2>
          <CadenceEditor userId={u.id} timezone={u.timezone} initial={{ postsPerWeek: cadence.postsPerWeek, weekdays: cadence.weekdays, times: cadence.times }} />
        </section>
      )}

      <section className="mt-14">
        <h2 className="card-title mb-4">WhatsApp</h2>
        <Card className="max-w-3xl bg-blush-50/40">
          <Thread messages={JSON.parse(JSON.stringify(messages))} />
        </Card>
      </section>
    </>
  );
}
