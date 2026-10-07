import { DateTime } from "luxon";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { staffActor } from "@/server/page-auth";
import { listAudit } from "@/server/services/accounts";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ userId?: string }> }) {
  const actor = await staffActor();
  const { userId } = await searchParams;
  const entries = await listAudit(actor, { userId, limit: 300 });
  const ids = [...new Set(entries.map((e) => e.userId).filter(Boolean))] as string[];
  const users = ids.length ? await db.select().from(schema.users).where(inArray(schema.users.id, ids)) : [];
  const staffIds = [...new Set(entries.filter((e) => e.actorType === "staff").map((e) => e.actorId!))];
  const staff = staffIds.length ? await db.select().from(schema.staff).where(inArray(schema.staff.id, staffIds)) : [];
  const who = (t: string, id: string | null) =>
    t === "system" ? "System" : t === "staff" ? staff.find((s) => s.id === id)?.name ?? "Staff" : users.find((u) => u.id === id)?.displayName ?? "User";

  return (
    <>
      <PageHeader eyebrow="Audit log" lead="Every change," accent="on the record." intro="Who did what, including actions taken on a user's behalf." />
      <Card className="overflow-x-auto p-0">
        {entries.length === 0 ? (
          <EmptyState icon="eye" title="Nothing logged yet" />
        ) : (
          <table className="w-full text-left text-[14px]">
            <thead className="bg-blush-50 text-[12px] font-bold uppercase text-ink">
              <tr>
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Who</th>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Account</th>
                <th className="px-5 py-3">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-5 py-3 whitespace-nowrap text-muted">{DateTime.fromJSDate(e.createdAt).toFormat("d LLL, HH:mm")}</td>
                  <td className="px-5 py-3 whitespace-nowrap">{who(e.actorType, e.actorId)}</td>
                  <td className="px-5 py-3 font-medium text-ink">{e.action}</td>
                  <td className="px-5 py-3 whitespace-nowrap">{users.find((u) => u.id === e.userId)?.displayName ?? "—"}</td>
                  <td className="max-w-md px-5 py-3 text-[12px] text-muted">
                    <code className="line-clamp-3 break-all">{e.after ? JSON.stringify(e.after) : ""}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
