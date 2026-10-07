import { DateTime } from "luxon";
import { userActor } from "@/server/page-auth";
import { listVersions } from "@/server/services/persona";
import type { Persona } from "@/server/persona-schema";
import { PersonaEditor } from "@/components/persona-editor";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PersonaPage() {
  const actor = await userActor();
  const versions = await listVersions(actor, actor.id);
  const active = versions.find((v) => v.status === "active");
  return (
    <>
      <PageHeader eyebrow={`Persona · version ${active?.version ?? "–"}`} lead="Your voice," accent="written down." intro="Every draft is written from this. It also learns from your edits over time." />
      {active && <PersonaEditor userId={actor.id} persona={active.json as Persona} version={active.version} />}
      <section className="mt-12">
        <h2 className="card-title mb-4">History</h2>
        <Card className="p-0">
          <ul className="divide-y divide-line text-[14px]">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-4 px-6 py-3">
                <span className="w-10 font-bold text-ink">v{v.version}</span>
                <span className="flex-1 text-ink-soft">{v.changeNote ?? "—"}</span>
                <span className="text-muted">{DateTime.fromJSDate(v.createdAt).toFormat("d LLL yyyy, HH:mm")}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </>
  );
}
