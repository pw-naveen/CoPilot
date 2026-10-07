"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, Notice } from "@/components/ui";

export function AccountSettings(p: { userId: string; staffApprovalIsFinal: boolean; status: string; canInvite: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "info" | "alert"; text: string } | null>(null);
  const patch = async (body: object) => {
    try {
      await api(`/api/admin/users/${p.userId}`, { method: "PATCH", body });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "alert", text: (e as Error).message });
    }
  };
  return (
    <Card className="flex flex-col gap-5">
      <h2 className="card-title">Account settings</h2>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <label className="flex items-start gap-3 text-[14px]">
        <input
          type="checkbox"
          className="mt-1 accent-[var(--red)]"
          checked={p.staffApprovalIsFinal}
          onChange={(e) => patch({ staffApprovalIsFinal: e.target.checked })}
        />
        <span>
          <span className="block font-semibold text-ink">Staff approval is final</span>
          <span className="text-muted">Off by default: when staff approve, the user still approves too.</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-3">
        {p.status === "active" && (
          <Button size="sm" variant="secondary" onClick={() => patch({ status: "paused" })}>
            Pause account
          </Button>
        )}
        {p.status === "paused" && (
          <Button size="sm" variant="secondary" onClick={() => patch({ status: "active" })}>
            Resume account
          </Button>
        )}
        {p.canInvite && (p.status === "invited" || p.status === "onboarding") && (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await api(`/api/admin/users/${p.userId}/reinvite`, { method: "POST" });
              setMsg({ tone: "info", text: "Invite sent again." });
            }}
          >
            Resend invite
          </Button>
        )}
      </div>
    </Card>
  );
}
