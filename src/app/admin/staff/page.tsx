import { redirect } from "next/navigation";
import { staffActor } from "@/server/page-auth";
import { listStaff, listUsers } from "@/server/services/accounts";
import { Card, PageHeader } from "@/components/ui";
import { InviteStaffForm, SubadminRow } from "./staff-client";

export default async function StaffPage() {
  const actor = await staffActor();
  if (actor.role !== "admin") redirect("/admin");
  const [staff, users] = await Promise.all([listStaff(actor), listUsers(actor)]);
  const subs = staff.filter((s) => s.role === "subadmin");
  return (
    <>
      <PageHeader eyebrow="Sub-admins" lead="Shared work," accent="clear scope." intro="Sub-admins see and act only on the accounts assigned to them." />
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          {subs.length === 0 && <Card className="text-muted">No sub-admins yet.</Card>}
          {subs.map((s) => (
            <SubadminRow key={s.id} staff={s} users={users.map((u) => ({ id: u.id, name: u.displayName }))} />
          ))}
        </div>
        <Card>
          <h2 className="card-title mb-5">Invite a sub-admin</h2>
          <InviteStaffForm />
        </Card>
      </div>
    </>
  );
}
