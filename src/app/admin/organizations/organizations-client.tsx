"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, EmptyState, Field, Icon, Input, Notice, Textarea, cx } from "@/components/ui";

export type Org = { id: string; name: string; context: string; active: boolean; members: number };

const MAX = 8000;

export function OrganizationsClient({ initial }: { initial: Org[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(initial.length === 0);

  const call = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4">
        {err && <Notice tone="alert">{err}</Notice>}
        {initial.length === 0 ? (
          <Card>
            <EmptyState icon="buildings" title="No organizations yet">
              Add one and it appears in the sign-up form. Until then people type their company name themselves.
            </EmptyState>
          </Card>
        ) : (
          initial.map((o) => (
            <OrgCard key={o.id} org={o} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} call={call} />
          ))
        )}
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="card-title">Add an organization</h2>
          {!creating && (
            <button onClick={() => setCreating(true)} className="text-[13px] font-semibold text-red-text">
              New
            </button>
          )}
        </div>
        {creating ? (
          <NewOrg onDone={() => setCreating(false)} call={call} />
        ) : (
          <p className="text-[13px] text-muted">
            Sign-ups choose from {initial.length} organization{initial.length === 1 ? "" : "s"}.
          </p>
        )}
      </Card>
    </div>
  );
}

function NewOrg({ onDone, call }: { onDone: () => void; call: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await call(() => api("/api/admin/organizations", { body: { name, context } }))) {
          setName("");
          setContext("");
          onDone();
        }
        setBusy(false);
      }}
    >
      <Field label="Name">
        <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Mediwira" />
      </Field>
      <Field label="Brief" hint="Optional now — you can write it after.">
        <Textarea
          value={context}
          maxLength={MAX}
          onChange={(e) => setContext(e.target.value)}
          placeholder="House writing rules, compliance lines, things never to claim…"
          className="min-h-24"
        />
      </Field>
      <Button type="submit" disabled={busy || name.trim().length < 2} size="sm">
        {busy ? "Adding…" : "Add organization"}
      </Button>
    </form>
  );
}

function OrgCard({
  org,
  open,
  onToggle,
  call,
}: {
  org: Org;
  open: boolean;
  onToggle: () => void;
  call: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [context, setContext] = useState(org.context);
  const [name, setName] = useState(org.name);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = context !== org.context || name !== org.name;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-blush-100">
          <Icon name="buildings" size={18} className="text-red" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">{org.name}</span>
          <span className="block text-[13px] text-muted">
            {org.members} {org.members === 1 ? "person" : "people"} ·{" "}
            {org.context.trim() ? `${org.context.trim().length} characters of brief` : "no brief yet"}
            {!org.active && " · closed to new sign-ups"}
          </span>
        </span>
        <button
          onClick={onToggle}
          className="flex-none rounded-[10px] px-3 py-1.5 text-[13px] font-semibold text-red-text hover:bg-blush-50"
        >
          {open ? "Close" : org.context.trim() ? "Edit brief" : "Write brief"}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-4 border-t border-line p-5">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label="Organisation brief"
            hint="Goes to the model with every draft, review and rewrite for everyone here. Where it conflicts with someone's persona, the brief wins."
          >
            <Textarea
              value={context}
              maxLength={MAX}
              onChange={(e) => {
                setContext(e.target.value);
                setSaved(false);
              }}
              placeholder={
                "e.g.\n- Never name a client or a matter, even where it is public.\n- Say “our team”, never “I” for firm-wide work.\n- No figures that aren't in a published report.\n- Everything must read as general information, never advice."
              }
              className="min-h-64 font-[inherit]"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={busy || !dirty || name.trim().length < 2}
              onClick={async () => {
                setBusy(true);
                if (await call(() => api(`/api/admin/organizations/${org.id}`, { method: "PATCH", body: { name, context } })))
                  setSaved(true);
                setBusy(false);
              }}
            >
              {busy ? "Saving…" : "Save brief"}
            </Button>
            <span className={cx("text-[13px] text-muted", !saved && "invisible")}>Saved</span>
            <span className="flex-1" />
            <span className="text-[12px] text-graphite-700 tabular-nums">
              {context.length} / {MAX}
            </span>
          </div>
          <div className="flex flex-wrap gap-3 border-t border-line pt-4">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => call(() => api(`/api/admin/organizations/${org.id}`, { method: "PATCH", body: { active: !org.active } }))}
            >
              {org.active ? "Close to new sign-ups" : "Open to new sign-ups"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (
                  !confirm(
                    `Delete ${org.name}? Its ${org.members} ${org.members === 1 ? "person keeps their" : "people keep their"} account and posts; they just stop inheriting the brief.`,
                  )
                )
                  return;
                call(() => api(`/api/admin/organizations/${org.id}`, { method: "DELETE" }));
              }}
            >
              <Icon name="trash" size={15} className="text-current" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
