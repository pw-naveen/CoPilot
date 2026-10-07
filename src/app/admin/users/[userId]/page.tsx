import { notFound } from "next/navigation";
import { staffActor } from "@/server/page-auth";
import { getUser } from "@/server/services/accounts";
import { canAccessUser } from "@/server/scope";
import { Card, PageHeader, StatusPill } from "@/components/ui";
import { AccountSettings } from "./account-settings";

export default async function UserDetail({ params }: { params: Promise<{ userId: string }> }) {
  const actor = await staffActor();
  const { userId } = await params;
  if (!(await canAccessUser(actor, userId))) notFound();
  const u = await getUser(actor, userId);
  return (
    <>
      <PageHeader eyebrow={u.title ?? "Account"} lead={u.displayName} accent={u.org ?? undefined} />
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <Card>
          <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-[14px]">
            <dt className="text-muted">Status</dt>
            <dd><StatusPill status={u.status} /></dd>
            <dt className="text-muted">Email</dt>
            <dd>{u.email}</dd>
            <dt className="text-muted">WhatsApp</dt>
            <dd>{u.phoneE164} {u.whatsappVerifiedAt ? "· verified" : "· not verified"}</dd>
            <dt className="text-muted">Time zone</dt>
            <dd>{u.timezone}</dd>
            <dt className="text-muted">Setup step</dt>
            <dd>{u.status === "active" ? "Complete" : `${u.onboardingStep} of 7`}</dd>
          </dl>
        </Card>
        <AccountSettings
          userId={u.id}
          staffApprovalIsFinal={u.staffApprovalIsFinal}
          status={u.status}
          canInvite={actor.role === "admin" || actor.canInvite}
        />
      </div>
    </>
  );
}
