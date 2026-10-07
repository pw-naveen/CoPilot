"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, waitForJob } from "@/lib/api";
import { Recorder } from "@/components/recorder";
import { Button, Card, Icon, Label, PageHeader, Textarea, cx } from "@/components/ui";
import { ContinueBar, ReviewOnly } from "./step-common";

type Answer = { key: string; text: string; transcript: string | null; audio: string | null };
type Sample = { id: string; source: string; text: string };
const MIN = 6;

export function VoiceStep(p: {
  userId: string;
  editable: boolean;
  questions: { key: string; q: string }[];
  answers: Answer[];
  prefs: Record<string, string>;
  samples: Sample[];
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(Object.fromEntries(p.answers.map((a) => [a.key, a])));
  const answered = p.questions.filter((q) => (answers[q.key]?.text ?? "").trim() || answers[q.key]?.audio).length;
  const transcribing = Object.values(answers).some((a) => a.audio && !a.transcript);

  return (
    <>
      <PageHeader
        eyebrow="Step 2 · Your voice"
        lead="Tell us how you think."
        accent="We'll learn how you write."
        intro={`Type or record each answer, whichever is quicker. Answer at least ${MIN} of the ${p.questions.length}; more answers make a better persona.`}
      />
      {!p.editable && <div className="mb-6"><ReviewOnly /></div>}

      <section className="flex flex-col gap-5">
        {p.questions.map((q, i) => (
          <QuestionCard
            key={q.key}
            n={i + 1}
            userId={p.userId}
            q={q}
            answer={answers[q.key]}
            editable={p.editable}
            onChange={(a) => setAnswers((prev) => ({ ...prev, [q.key]: a }))}
          />
        ))}
      </section>

      <ToneSliders userId={p.userId} initial={p.prefs} editable={p.editable} />
      <Samples userId={p.userId} initial={p.samples} editable={p.editable} />

      {p.editable && (
        <ContinueBar
          userId={p.userId}
          step={3}
          label="Build my persona"
          disabled={answered < MIN || transcribing}
          hint={transcribing ? "Waiting for a voice note to finish transcribing…" : `${answered} of ${p.questions.length} answered`}
        />
      )}
    </>
  );
}

function QuestionCard(p: { n: number; userId: string; q: { key: string; q: string }; answer?: Answer; editable: boolean; onChange: (a: Answer) => void }) {
  const a = p.answer ?? { key: p.q.key, text: "", transcript: null, audio: null };
  const [text, setText] = useState(a.text);
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const last = useRef(a.text);

  async function save() {
    if (text === last.current) return;
    await api(`/api/users/${p.userId}/answers/${p.q.key}`, { method: "PUT", body: { text } });
    last.current = text;
    setSaved(true);
    p.onChange({ ...a, text });
  }

  async function upload(blob: Blob) {
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.set("audio", new File([blob], "answer.webm", { type: blob.type }));
      const res = await fetch(`/api/users/${p.userId}/answers/${p.q.key}/audio`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      p.onChange({ ...a, audio: URL.createObjectURL(blob), transcript: null });
      const { transcript } = await waitForJob<{ transcript: string }>(data.jobId);
      p.onChange({ ...a, audio: URL.createObjectURL(blob), transcript });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const done = !!(text.trim() || a.audio);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <span className={cx("grid h-8 w-8 flex-none place-items-center rounded-full text-[13px] font-bold", done ? "bg-red text-white" : "bg-blush-100 text-red-text")}>
          {done ? <Icon name="check" size={16} className="text-white" /> : p.n}
        </span>
        <p className="pt-1 text-[16px] font-medium text-ink">{p.q.q}</p>
      </div>
      <Textarea
        disabled={!p.editable}
        value={text}
        placeholder="Type your answer, or record it below…"
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        onBlur={save}
      />
      <div className="flex flex-wrap items-center gap-3">
        {p.editable && <Recorder onDone={upload} disabled={busy} label={a.audio ? "Re-record" : "Record answer"} />}
        {a.audio && <audio src={a.audio} controls className="h-9 max-w-[260px]" />}
        {busy && !a.transcript && <span className="text-[13px] text-muted">Transcribing…</span>}
        {!saved && <span className="text-[12px] text-muted">Unsaved, saves when you click away</span>}
        {err && <span className="text-[13px] text-red-text">{err}</span>}
      </div>
      {a.transcript && (
        <div className="rounded-[16px] bg-blush-50 px-4 py-3 text-[14px] text-ink-soft">
          <Label>Transcript</Label>
          <p className="mt-1">{a.transcript}</p>
        </div>
      )}
    </Card>
  );
}

function Slider({ label, left, right, value, onChange, disabled }: { label: string; left: string; right: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      <input type="range" min={0} max={1} step={0.1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--red)]" />
      <span className="flex justify-between text-[12px] text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </span>
    </label>
  );
}

function Choice({ label, options, value, onChange, disabled }: { label: string; options: [string, string][]; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button
            type="button"
            key={v}
            disabled={disabled}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cx("h-9 rounded-[16px] px-3 text-[13px] font-medium", value === v ? "bg-red text-white" : "bg-blush-50 text-ink-soft hover:bg-blush-100")}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToneSliders({ userId, initial, editable }: { userId: string; initial: Record<string, string>; editable: boolean }) {
  const [v, setV] = useState({
    "pref.formality": initial["pref.formality"] || "0.5",
    "pref.personal": initial["pref.personal"] || "0.5",
    "pref.length": initial["pref.length"] || "medium",
    "pref.emoji": initial["pref.emoji"] || "rare",
    "pref.hashtags": initial["pref.hashtags"] || "max 3, at end",
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      // Persist defaults once so the persona always has preferences to work from.
      if (Object.keys(initial).every((k) => !initial[k]) && editable)
        Object.entries(v).forEach(([k, val]) => api(`/api/users/${userId}/answers/${k}`, { method: "PUT", body: { text: val } }));
      return;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof v) => (val: string | number) => {
    const s = String(val);
    setV((prev) => ({ ...prev, [k]: s }));
    api(`/api/users/${userId}/answers/${k}`, { method: "PUT", body: { text: s } });
  };
  return (
    <section className="mt-12">
      <h2 className="card-title mb-4">Tone preferences</h2>
      <Card className="grid gap-8 md:grid-cols-2">
        <Slider label="Formality" left="Conversational" right="Formal" value={Number(v["pref.formality"])} onChange={set("pref.formality")} disabled={!editable} />
        <Slider label="Openness" left="Reserved" right="Personal" value={Number(v["pref.personal"])} onChange={set("pref.personal")} disabled={!editable} />
        <Choice label="Length" value={v["pref.length"]} onChange={set("pref.length")} disabled={!editable} options={[["short", "Concise"], ["medium", "Medium"], ["long", "Detailed"]]} />
        <Choice label="Emoji" value={v["pref.emoji"]} onChange={set("pref.emoji")} disabled={!editable} options={[["none", "Never"], ["rare", "Rarely"], ["some", "Sometimes"]]} />
        <Choice
          label="Hashtags"
          value={v["pref.hashtags"]}
          onChange={set("pref.hashtags")}
          disabled={!editable}
          options={[["none", "None"], ["max 3, at end", "Up to 3, at the end"], ["3 to 5, at end", "3 to 5, at the end"]]}
        />
      </Card>
    </section>
  );
}

function Samples({ userId, initial, editable }: { userId: string; initial: Sample[]; editable: boolean }) {
  const router = useRouter();
  const [samples, setSamples] = useState(initial);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function add() {
    setErr(null);
    try {
      const { sample } = await api(`/api/users/${userId}/samples`, { body: { text, source: "paste" } });
      setSamples([...samples, sample]);
      setText("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function upload(file: File) {
    setErr(null);
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`/api/users/${userId}/samples`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) return setErr(data.error);
    setSamples([...samples, data.sample]);
  }

  return (
    <section className="mt-12">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="card-title">Writing samples</h2>
        <span className="text-[13px] text-muted">{samples.length} of 10 · optional, strongly encouraged</span>
      </div>
      <Card className="flex flex-col gap-4">
        <p className="text-[14px] text-muted">Paste 3 to 10 things you've written: past LinkedIn posts, a speech, an email. These teach the persona your real voice.</p>
        {samples.map((s) => (
          <div key={s.id} className="flex items-start gap-3 rounded-[16px] bg-blush-50 px-4 py-3">
            <Icon name="note-pencil" size={18} className="mt-0.5 text-red" />
            <p className="line-clamp-2 flex-1 text-[14px] text-ink-soft">{s.text}</p>
            {editable && (
              <button
                aria-label="Remove sample"
                className="text-muted hover:text-red-text"
                onClick={async () => {
                  await api(`/api/users/${userId}/samples/${s.id}`, { method: "DELETE" });
                  setSamples(samples.filter((x) => x.id !== s.id));
                  router.refresh();
                }}
              >
                <Icon name="trash" size={18} className="text-current" />
              </button>
            )}
          </div>
        ))}
        {editable && samples.length < 10 && (
          <>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a post, speech or email…" />
            {err && <span className="text-[13px] text-red-text">{err}</span>}
            <div className="flex flex-wrap gap-3">
              <Button size="sm" variant="secondary" disabled={text.trim().length < 40} onClick={add}>
                Add sample
              </Button>
              <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
                <Icon name="upload-simple" size={16} className="text-current" /> Upload .txt
              </Button>
              <input ref={fileRef} type="file" accept=".txt,.md,text/plain" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
