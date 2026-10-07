import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { PageHeader } from "@/components/ui";
import { MockPhone } from "./mock-phone";

export const dynamic = "force-dynamic";

export default async function DevPhone({ searchParams }: { searchParams: Promise<{ phone?: string }> }) {
  const users = await db.select({ name: schema.users.displayName, phone: schema.users.phoneE164, status: schema.users.status }).from(schema.users).orderBy(asc(schema.users.displayName));
  const { phone } = await searchParams;
  return (
    <>
      <PageHeader eyebrow="Mock phone" lead="Chat as any user," accent="no SIM needed." intro="Messages go through the MockGateway into the same pipeline as Evolution. Fragments are bundled after the quiet period; send “done” to process straight away." />
      <MockPhone users={users} initial={phone ?? users[0]?.phone ?? ""} />
    </>
  );
}
