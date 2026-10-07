"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Notice } from "@/components/ui";

const NEXT = ["", "", "voice", "persona", "tone", "cadence", "whatsapp", ""];

/** "Continue" for the current step: completes it on the server, then moves on. */
export function ContinueBar({
  userId,
  step,
  disabled,
  hint,
  label = "Continue",
  before,
}: {
  userId: string;
  step: number;
  disabled?: boolean;
  hint?: string;
  label?: string;
  before?: () => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-10 flex flex-col gap-3">
      {err && <Notice tone="alert">{err}</Notice>}
      <div className="flex flex-wrap items-center gap-4">
        <Button
          disabled={disabled || busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await before?.();
              await api(`/api/users/${userId}/onboarding/step`, { body: { step } });
              router.push(`/onboarding/${NEXT[step]}`);
              router.refresh();
            } catch (e) {
              setErr((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : label}
        </Button>
        {hint && <span className="text-[13px] text-muted">{hint}</span>}
      </div>
    </div>
  );
}

export function ReviewOnly() {
  return <Notice>You've completed this step. You can review it here; changes are made from your account later.</Notice>;
}
