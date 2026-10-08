"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, Icon, Notice } from "@/components/ui";

export type Pending = {
  id: string;
  name: string;
  email: string;
  org: string | null;
  phoneE164: string;
  createdAt: string;
};

/** Self-registered accounts waiting on an admin decision before they can sign in. */
export function PendingRegistrations({ pending }: { pending: Pending[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function decide(id: string, decision: "approve" | "reject") {
    if (decision === "reject" && !confirm("Reject this registration? They won't be able to sign in.")) return;
    setBusy(id);
    setErr(null);
    try {
      await api(`/api/users/${id}/approval`, { body: { decision } });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!pending.length) return null;

  return (
    <Card className="mb-8 p-0">
      <div className="flex items-center gap-3 border-b border-line px-6 py-4">
        <span className="relative grid h-9 w-9 flex-none place-items-center rounded-full bg-blush-100">
          <Icon name="user-circle" size={20} className="text-red" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="card-title">Waiting for approval</h2>
          <p className="text-[13px] text-muted">
            {pending.length} {pending.length === 1 ? "person has" : "people have"} registered and can't sign in yet.
          </p>
        </div>
      </div>
      {err && (
        <div className="px-6 pt-4">
          <Notice tone="alert">{err}</Notice>
        </div>
      )}
      <ul className="divide-y divide-line">
        {pending.map((p) => (
          <li key={p.id} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:gap-4">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">{p.name}</span>
              <span className="block truncate text-[13px] text-muted">
                {p.email}
                {p.org ? ` · ${p.org}` : ""} · {p.phoneE164}
              </span>
            </span>
            <span className="flex flex-none gap-2">
              <Button size="sm" disabled={busy === p.id} onClick={() => decide(p.id, "approve")}>
                {busy === p.id ? "Working…" : "Approve"}
              </Button>
              <Button size="sm" variant="danger" disabled={busy === p.id} onClick={() => decide(p.id, "reject")}>
                Reject
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
