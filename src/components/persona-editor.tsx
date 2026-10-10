"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, waitForJob } from "@/lib/api";
import type { Persona } from "@/server/persona-schema";
import { Button, Card, Icon, IconCircle, Input, Label, Notice, Statement, Textarea, cx } from "./ui";
import { Working } from "./working";

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** Polls the page while the worker builds the persona. */
export function PersonaPending() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [router]);
  return (
    <Card className="p-0">
      <Working title="Building your persona" size={104}>
        Reading your answers and samples. This usually takes under a minute.
      </Working>
    </Card>
  );
}

export function PersonaEditor({ userId, persona, version, editable = true }: { userId: string; persona: Persona; version: number; editable?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "regen" | "save">(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => toForm(persona));

  useEffect(() => {
    setDraft(toForm(persona));
  }, [persona]);

  async function regenerate() {
    setBusy("regen");
    setErr(null);
    try {
      const { jobId } = await api(`/api/users/${userId}/persona/generate`, { body: { note } });
      await waitForJob(jobId);
      setNote("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setErr(null);
    try {
      await api(`/api/users/${userId}/persona`, { method: "PUT", body: { json: fromForm(draft, persona) } });
      setMode("view");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (mode === "edit")
    return (
      <Card className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="card-title">Edit persona</h2>
          <span className="text-[13px] text-muted">Saving creates version {version + 1}</span>
        </div>
        {err && <Notice tone="alert">{err}</Notice>}
        <EditField label="How you write" hint="Two or three sentences" value={draft.voice_summary} onChange={(v) => setDraft({ ...draft, voice_summary: v })} />
        <EditField label="Role summary" value={draft.role_summary} onChange={(v) => setDraft({ ...draft, role_summary: v })} rows={2} />
        <EditField label="Content pillars" hint="One per line: Name — what it covers" value={draft.pillars} onChange={(v) => setDraft({ ...draft, pillars: v })} />
        <EditField label="Audience" hint="One per line" value={draft.audience} onChange={(v) => setDraft({ ...draft, audience: v })} />
        <div className="grid gap-6 md:grid-cols-2">
          <EditField label="Do" hint="One per line" value={draft.do} onChange={(v) => setDraft({ ...draft, do: v })} />
          <EditField label="Don't" hint="One per line" value={draft.dont} onChange={(v) => setDraft({ ...draft, dont: v })} />
          <EditField label="Signature moves" hint="One per line" value={draft.signature_moves} onChange={(v) => setDraft({ ...draft, signature_moves: v })} />
          <EditField label="Banned phrases" hint="One per line" value={draft.banned_phrases} onChange={(v) => setDraft({ ...draft, banned_phrases: v })} />
          <EditField label="Topics to avoid" hint="One per line" value={draft.topics_to_avoid} onChange={(v) => setDraft({ ...draft, topics_to_avoid: v })} />
          <div className="flex flex-col gap-4">
            <Label>Voice</Label>
            <label className="flex flex-col gap-1 text-[13px]">
              Formality ({draft.formality.toFixed(1)})
              <input type="range" min={0} max={1} step={0.1} value={draft.formality} onChange={(e) => setDraft({ ...draft, formality: Number(e.target.value) })} className="accent-[var(--red)]" />
            </label>
            <label className="flex flex-col gap-1 text-[13px]">
              Openness ({draft.personal.toFixed(1)})
              <input type="range" min={0} max={1} step={0.1} value={draft.personal} onChange={(e) => setDraft({ ...draft, personal: Number(e.target.value) })} className="accent-[var(--red)]" />
            </label>
            <label className="flex flex-col gap-1 text-[13px]">
              Hashtags
              <Input value={draft.hashtags} onChange={(e) => setDraft({ ...draft, hashtags: e.target.value })} />
            </label>
          </div>
        </div>
        <div className="flex gap-3">
          <Button onClick={save} disabled={!!busy}>
            {busy === "save" ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="ghost" onClick={() => { setDraft(toForm(persona)); setMode("view"); }}>
            Cancel
          </Button>
        </div>
      </Card>
    );

  return (
    <div className="flex flex-col gap-6">
      {err && <Notice tone="alert">{err}</Notice>}
      <Statement>
        <Label>How you write</Label>
        <p className="mt-2 text-[20px] leading-snug font-light text-ink">{persona.voice_summary}</p>
      </Statement>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <Label>Content pillars</Label>
          <ul className="mt-4 flex flex-col gap-4">
            {persona.content_pillars.map((c, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1 text-[13px] font-bold text-red-text">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="block font-semibold text-ink">{c.name}</span>
                  <span className="text-[14px] text-muted">{c.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-5">
          <div>
            <Label>Writing for</Label>
            <p className="mt-2 text-[14px]">{persona.audience.join(" · ")}</p>
          </div>
          <div>
            <Label>Voice</Label>
            <Meter left="Conversational" right="Formal" value={persona.voice.formality} />
            <Meter left="Reserved" right="Personal" value={persona.voice.personal} />
            <p className="mt-3 text-[13px] text-muted">
              {cap(persona.voice.length)} posts · emoji {persona.voice.emoji} · hashtags {persona.voice.hashtags}
            </p>
          </div>
          {persona.signature_moves.length > 0 && (
            <div>
              <Label>Signature moves</Label>
              <ul className="mt-2 list-disc pl-5 text-[14px]">{persona.signature_moves.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
        </Card>
        <ListCard title="Do" icon="check-circle" items={persona.do} />
        <ListCard title="Don't" icon="x-circle" items={[...persona.dont, ...persona.banned_phrases.map((b) => `Say “${b}”`)]} />
      </div>
      {persona.topics_to_avoid.length > 0 && (
        <Card>
          <Label>Never posts about</Label>
          <p className="mt-2 text-[14px]">{persona.topics_to_avoid.join(" · ")}</p>
        </Card>
      )}

      {editable && (
        <Card className="flex flex-col gap-4">
          <p className="card-title">Not quite you?</p>
          <p className="text-[14px] text-muted">Edit any part directly, or tell us what to change and we'll rewrite it.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. less corporate, more about mentoring" className="flex-1" />
            <Button variant="secondary" disabled={!note.trim() || !!busy} onClick={regenerate}>
              <Icon name="arrows-clockwise" size={16} className="text-current" />
              {busy === "regen" ? "Rewriting…" : "Regenerate"}
            </Button>
            <Button variant="ghost" onClick={() => setMode("edit")} disabled={!!busy}>
              <Icon name="pencil-simple" size={16} className="text-current" /> Edit
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Meter({ left, right, value }: { left: string; right: string; value: number }) {
  return (
    <div className="mt-3">
      <div className="relative h-[3px] bg-blush-100">
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red shadow-disc" style={{ left: `${value * 100}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function ListCard({ title, icon, items }: { title: string; icon: "check-circle" | "x-circle"; items: string[] }) {
  return (
    <Card>
      <Label>{title}</Label>
      <ul className="mt-4 flex flex-col gap-2.5">
        {items.map((d, i) => (
          <li key={i} className="flex gap-2.5 text-[14px]">
            <Icon name={icon} size={18} className={cx("mt-0.5", icon === "check-circle" ? "text-red" : "text-graphite-500")} />
            {d}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EditField({ label, hint, value, onChange, rows = 4 }: { label: string; hint?: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-0" />
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function toForm(p: Persona) {
  return {
    voice_summary: p.voice_summary,
    role_summary: p.role_summary,
    pillars: p.content_pillars.map((c) => `${c.name} — ${c.description}`).join("\n"),
    audience: p.audience.join("\n"),
    do: p.do.join("\n"),
    dont: p.dont.join("\n"),
    signature_moves: p.signature_moves.join("\n"),
    banned_phrases: p.banned_phrases.join("\n"),
    topics_to_avoid: p.topics_to_avoid.join("\n"),
    formality: p.voice.formality,
    personal: p.voice.personal,
    hashtags: p.voice.hashtags,
  };
}

function fromForm(f: ReturnType<typeof toForm>, base: Persona): Persona {
  return {
    ...base,
    voice_summary: f.voice_summary.trim(),
    role_summary: f.role_summary.trim(),
    content_pillars: lines(f.pillars).map((l) => {
      const [name, ...rest] = l.split(/\s+[—-]\s+/);
      return { name: name.trim(), description: rest.join(" — ").trim() || name.trim() };
    }),
    audience: lines(f.audience),
    do: lines(f.do),
    dont: lines(f.dont),
    signature_moves: lines(f.signature_moves),
    banned_phrases: lines(f.banned_phrases),
    topics_to_avoid: lines(f.topics_to_avoid),
    voice: { ...base.voice, formality: f.formality, personal: f.personal, hashtags: f.hashtags.trim() || "none" },
  };
}
