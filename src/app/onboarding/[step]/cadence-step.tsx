"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { CadenceEditor } from "@/components/cadence-editor";
import { PageHeader } from "@/components/ui";
import { ReviewOnly } from "./step-common";

export function CadenceStep({ userId, editable, timezone, cadence }: { userId: string; editable: boolean; timezone: string; cadence: { postsPerWeek: number; weekdays: number[]; times: string[] } | null }) {
  const router = useRouter();
  return (
    <>
      <PageHeader eyebrow="Step 5 · Cadence" lead="A steady rhythm" accent="beats a busy week." intro="Choose how often you post and when. You can change it any time; only future, unstarted posts move." />
      {!editable && <div className="mb-6"><ReviewOnly /></div>}
      <CadenceEditor
        userId={userId}
        timezone={timezone}
        initial={cadence}
        editable={true}
        saveLabel={editable ? "Save and continue" : "Save cadence"}
        onSaved={async () => {
          if (!editable) return;
          await api(`/api/users/${userId}/onboarding/step`, { body: { step: 6 } });
          router.push("/onboarding/whatsapp");
          router.refresh();
        }}
      />
    </>
  );
}
