"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, Field, Icon, Input, Notice } from "@/components/ui";

export function AccountSettings(p: {
  userId: string;
  email: string;
  displayName: string;
  staffApprovalIsFinal: boolean;
  status: string;
  canInvite: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "info" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // `refresh: false` is for the delete: this page is the account, so re-rendering
  // it after the account is gone races the navigation away and lands on a 404.
  const run = async (fn: () => Promise<unknown>, ok?: string, opts: { refresh?: boolean } = {}) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: "info", text: ok });
      if (opts.refresh !== false) router.refresh();
      return true;
    } catch (e) {
      setMsg({ tone: "alert", text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const patch = (body: object) => run(() => api(`/api/admin/users/${p.userId}`, { method: "PATCH", body }));
  const suspended = p.status === "paused";

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

      {(p.status === "active" || suspended) && (
        <div className="flex flex-col gap-2 border-t border-line pt-5">
          <span className="text-[14px] font-semibold text-ink">{suspended ? "Suspended" : "Live"}</span>
          <p className="text-[13px] text-muted">
            {suspended
              ? "No drafts, reminders or new slots. Everything already written is kept, and resuming picks the schedule back up."
              : "Suspending stops drafts, reminders and slot generation. Nothing is deleted."}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            className="self-start"
            onClick={() =>
              run(
                () => api(`/api/admin/users/${p.userId}`, { method: "POST", body: { suspend: !suspended } }),
                suspended ? "Account resumed." : "Account suspended.",
              )
            }
          >
            <Icon name={suspended ? "play" : "pause"} size={15} className="text-current" />
            {suspended ? "Resume account" : "Suspend account"}
          </Button>
        </div>
      )}

      {p.canInvite && (p.status === "invited" || p.status === "onboarding") && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          disabled={busy}
          onClick={() => run(() => api(`/api/admin/users/${p.userId}/reinvite`, { method: "POST" }), "Invite sent again.")}
        >
          Resend invite
        </Button>
      )}

      {p.isAdmin && <DangerZone {...p} busy={busy} run={run} />}
    </Card>
  );
}

/**
 * Deleting is irreversible and sits one button away from suspending, so it asks
 * for the account's email rather than a yes/no — the thing you have to type is
 * the thing you are about to lose.
 */
function DangerZone({
  userId,
  email,
  displayName,
  busy,
  run,
}: {
  userId: string;
  email: string;
  displayName: string;
  busy: boolean;
  run: (fn: () => Promise<unknown>, ok?: string, opts?: { refresh?: boolean }) => Promise<boolean>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      {!open ? (
        <button onClick={() => setOpen(true)} className="self-start text-[13px] font-semibold text-red-text hover:underline">
          Delete this account…
        </button>
      ) : (
        <>
          <span className="text-[14px] font-semibold text-red-text">Delete {displayName}</span>
          <p className="text-[13px] text-muted">
            Removes the account, its persona, every draft and post, the calendar and the whole WhatsApp history. This cannot be
            undone; the audit log keeps a record that it happened. To switch the account off instead, suspend it.
          </p>
          <Field label={`Type ${email} to confirm`} htmlFor="confirm-delete">
            <Input
              id="confirm-delete"
              autoComplete="off"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={email}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={busy || confirmEmail.trim().toLowerCase() !== email.toLowerCase()}
              onClick={async () => {
                const ok = await run(
                  () => api(`/api/admin/users/${userId}`, { method: "DELETE", body: { confirmEmail } }),
                  undefined,
                  { refresh: false },
                );
                if (ok) {
                  router.replace("/admin/users");
                  router.refresh();
                }
              }}
            >
              <Icon name="trash" size={15} className="text-current" />
              Delete permanently
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
