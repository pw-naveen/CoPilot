"use client";

import type { Persona } from "@/server/persona-schema";
import { PageHeader } from "@/components/ui";
import { PersonaEditor, PersonaPending } from "@/components/persona-editor";
import { ContinueBar } from "./step-common";

export function PersonaStep({ userId, editable, persona }: { userId: string; editable: boolean; persona: { version: number; json: Persona } | null }) {
  return (
    <>
      <PageHeader eyebrow="Step 3 · Persona" lead="This is how" accent="you sound." intro="Read it as if a ghostwriter handed it to you. Edit anything, or ask for a rewrite with a note." />
      {persona ? <PersonaEditor userId={userId} persona={persona.json} version={persona.version} editable={editable} /> : <PersonaPending />}
      {editable && persona && <ContinueBar userId={userId} step={4} label="Looks like me, write samples" />}
    </>
  );
}
