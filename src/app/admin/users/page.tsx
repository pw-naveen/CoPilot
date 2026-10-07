import Link from "next/link";
import { staffActor } from "@/server/page-auth";
import { listUsers } from "@/server/services/accounts";
import { Card, EmptyState, Icon, PageHeader, StatusPill } from "@/components/ui";
import { InviteUserForm } from "./invite-form";

const STEP = ["", "Invite", "Profile", "Voice", "Persona", "Tone check", "Cadence", "WhatsApp"];

export default async function UsersPage() {
  const actor = await staffActor();
  const users = await listUsers(actor);
  const canInvite = actor.role === "admin" || actor.canInvite;
  return (
    <>
      <PageHeader
        eyebrow="Accounts"
        lead="Every voice,"
        accent="one place."
        intro={actor.role === "admin" ? "All accounts. Invite a new user to start their setup." : "The accounts assigned to you."}
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-0">
          {users.length === 0 ? (
            <EmptyState icon="users-three" title="No accounts yet">
              {canInvite ? "Invite the first user with the form." : "An admin hasn't assigned any accounts to you yet."}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {users.map((u) => (
                <li key={u.id}>
                  <Link href={`/admin/users/${u.id}`} className="flex items-center gap-4 px-6 py-4 hover:bg-blush-50">
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-blush-100 text-[14px] font-bold text-red-text">
                      {u.displayName.replace(/^Dr\.?\s+/i, "").slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{u.displayName}</span>
                      <span className="block truncate text-[13px] text-muted">
                        {[u.title, u.org].filter(Boolean).join(" · ") || u.email}
                      </span>
                    </span>
                    <span className="hidden text-[13px] text-muted md:block">
                      {u.status === "onboarding" ? `Step ${u.onboardingStep} · ${STEP[u.onboardingStep]}` : u.phoneE164}
                    </span>
                    <StatusPill status={u.status} />
                    <Icon name="caret-right" size={16} className="text-graphite-500" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canInvite && (
          <Card>
            <h2 className="card-title mb-5">Invite a user</h2>
            <InviteUserForm />
          </Card>
        )}
      </div>
    </>
  );
}
