import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { listSettings } from "@/server/config";
import { staffActor } from "@/server/page-auth";
import { Card, PageHeader } from "@/components/ui";
import { GlobalSettingsForm, TotpCard } from "./settings-client";
import { WhatsAppConnection } from "./whatsapp-connection";

export default async function SettingsPage() {
  const actor = await staffActor();
  const me = await db.query.staff.findFirst({ where: eq(schema.staff.id, actor.id) });
  return (
    <>
      <PageHeader eyebrow="Settings" lead="Set it once," accent="run it daily." />
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          {actor.role === "admin" && <WhatsAppConnection />}
          <TotpCard enabled={!!me?.totpSecret} />
        </div>
        {actor.role === "admin" && (
          <Card>
            <h2 className="card-title mb-1">Global settings</h2>
            <p className="mb-5 text-[13px] text-muted">API keys are stored encrypted. Model names are set by environment variables.</p>
            <GlobalSettingsForm initial={await listSettings()} />
          </Card>
        )}
      </div>
    </>
  );
}
