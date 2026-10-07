"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, Field, Input, Notice, cx } from "@/components/ui";

type Staff = { id: string; name: string; email: string; canInvite: boolean; totp: boolean; userIds: string[] };

export function SubadminRow({ staff, users }: { staff: Staff; users: { id: string; name: string }[] }) {
  const router = useRouter();
  const [ids, setIds] = useState(new Set(staff.userIds));
  const [canInvite, setCanInvite] = useState(staff.canInvite);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = ids.size !== staff.userIds.length || staff.userIds.some((i) => !ids.has(i)) || canInvite !== staff.canInvite;

  async function save() {
    setBusy(true);
    await api(`/api/admin/staff/${staff.id}/accounts`, { method: "PUT", body: { userIds: [...ids] } });
    if (canInvite !== staff.canInvite) await api(`/api/admin/staff/${staff.id}`, { method: "PATCH", body: { canInvite } });
    setBusy(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">{staff.name}</p>
          <p className="text-[13px] text-muted">
            {staff.email} · 2FA {staff.totp ? "on" : "off"}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" className="accent-[var(--red)]" checked={canInvite} onChange={(e) => { setCanInvite(e.target.checked); setSaved(false); }} />
          Can invite users
        </label>
      </div>
      <p className="mb-2 text-[12px] font-bold uppercase text-ink">Assigned accounts</p>
      <div className="flex flex-wrap gap-2">
        {users.map((u) => {
          const on = ids.has(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => {
                const n = new Set(ids);
                if (on) n.delete(u.id);
                else n.add(u.id);
                setIds(n);
                setSaved(false);
              }}
              className={cx("h-8 rounded-[16px] px-3 text-[13px] font-medium", on ? "bg-red text-white" : "bg-blush-50 text-ink-soft hover:bg-blush-100")}
              aria-pressed={on}
            >
              {u.name}
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Button size="sm" disabled={!dirty || busy} onClick={save}>
          Save
        </Button>
        {saved && !dirty && <span className="text-[13px] text-muted">Saved</span>}
      </div>
    </Card>
  );
}

export function InviteStaffForm() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", email: "", canInvite: false });
  const [msg, setMsg] = useState<{ tone: "info" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await api("/api/admin/staff", { body: f });
          setMsg({ tone: "info", text: `Invite sent to ${f.email}.` });
          setF({ name: "", email: "", canInvite: false });
          router.refresh();
        } catch (err) {
          setMsg({ tone: "alert", text: (err as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Field label="Name">
        <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Email">
        <Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-[14px]">
        <input type="checkbox" className="accent-[var(--red)]" checked={f.canInvite} onChange={(e) => setF({ ...f, canInvite: e.target.checked })} />
        Allow them to invite users into their scope
      </label>
      <Button disabled={busy}>Send invite</Button>
    </form>
  );
}
