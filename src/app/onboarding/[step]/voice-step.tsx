"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { clock, extFor, useRecorder } from "@/components/recorder";
import { Button, Card, Icon, Label, ProgressRing, Textarea, cx } from "@/components/ui";
import { Orb } from "@/components/orb";
import { FlowShell } from "../flow-shell";
import { ReviewOnly } from "./step-common";

type Answer = { key: string; text: string; transcript: string | null; audio: string | null };
type Sample = { id: string; source: string; text: string };
type Stage = "intro" | "questions" | "prefs" | "samples" | "review";

const MIN = 6;
const answeredQ = (a?: Answer) => !!((a?.text ?? "").trim() || a?.audio);

export function VoiceStep(p: {
  userId: string;
  editable: boolean;
  reached: number;
  displayName: string;
  questions: { key: string; q: string }[];
  answers: Answer[];
  prefs: Record<string, string>;
  samples: Sample[];
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(Object.fromEntries(p.answers.map((a) => [a.key, a])));
  const [stage, setStage] = useState<Stage>(() => (p.answers.some(answeredQ) ? "review" : "intro"));
  const [micLevel, setMicLevel] = useState(0);
  const [i, setI] = useState(0);

  const answered = p.questions.filter((q) => answeredQ(answers[q.key])).length;
  const pending = useMemo(() => p.questions.filter((q) => answers[q.key]?.audio && !answers[q.key]?.transcript).map((q) => q.key), [answers, p.questions]);

  const update = useCallback((key: string, patch: Partial<Answer>) => {
    setAnswers((prev) => {
      const base: Answer = prev[key] ?? { key, text: "", transcript: null, audio: null };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }, []);

  // One poller for every outstanding transcript. Pending state is derived from the
  // server (audio stored, transcript still null) rather than from job ids held in
  // memory, so closing the tab or reloading mid-flow doesn't lose track of them.
  useEffect(() => {
    if (!pending.length || !p.editable) return;
    let live = true;
    const id = setInterval(async () => {
      try {
        const { answers: rows } = await api<{ answers: { key: string; hasAudio: boolean; transcript: string | null }[] }>(`/api/users/${p.userId}/answers`);
        if (!live) return;
        setAnswers((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            const cur = next[r.key];
            if (cur && r.transcript && !cur.transcript) next[r.key] = { ...cur, transcript: r.transcript };
            if (cur && !r.hasAudio && cur.audio) next[r.key] = { ...cur, audio: null, transcript: null };
          }
          return next;
        });
      } catch {
        /* keep polling; a dropped request is not fatal */
      }
    }, 2500);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [pending.length, p.editable, p.userId]);

  // Reviewing a finished step: same shell as every other, so the step
  // navigation and the way out are in the places they always are.
  if (!p.editable)
    return (
      <FlowShell current={3} reached={p.reached} name={p.displayName} reviewOnly>
        <div className="py-5">
          <ReviewOnly />
        </div>
        <Review questions={p.questions} answers={answers} userId={p.userId} editable={false} onJump={() => {}} />
      </FlowShell>
    );

  const common = { userId: p.userId, answers, answered, total: p.questions.length, level: micLevel };

  if (stage === "intro") return <Intro total={p.questions.length} onStart={() => setStage("questions")} />;

  if (stage === "questions") {
    const q = p.questions[i];
    return (
      <Flow
        {...common}
        title={`Question ${i + 1} of ${p.questions.length}`}
        onBack={i === 0 ? () => setStage("intro") : () => setI(i - 1)}
        onSkipAll={() => setStage("review")}
      >
        <QuestionScreen
          key={q.key}
          userId={p.userId}
          q={q}
          n={i + 1}
          answer={answers[q.key]}
          onLevel={setMicLevel}
          onPatch={(patch) => update(q.key, patch)}
          onNext={() => (i + 1 < p.questions.length ? setI(i + 1) : setStage("prefs"))}
          isLast={i + 1 === p.questions.length}
        />
      </Flow>
    );
  }

  if (stage === "prefs")
    return (
      <Flow {...common} title="Tone preferences" onBack={() => setStage("questions")} onSkipAll={() => setStage("review")}>
        <ToneSliders userId={p.userId} initial={p.prefs} onDone={() => setStage("samples")} />
      </Flow>
    );

  if (stage === "samples")
    return (
      <Flow {...common} title="Writing samples" onBack={() => setStage("prefs")} onSkipAll={() => setStage("review")}>
        <Samples userId={p.userId} initial={p.samples} onDone={() => setStage("review")} />
      </Flow>
    );

  return (
    <Flow {...common} title="Review" onBack={() => setStage("questions")}>
      <Review
        questions={p.questions}
        answers={answers}
        userId={p.userId}
        editable
        onJump={(idx) => {
          setI(idx);
          setStage("questions");
        }}
      />
      <Finish userId={p.userId} answered={answered} pending={pending.length} />
    </Flow>
  );
}

// ── Chrome ────────────────────────────────────────────────────────────────

/** Stage frame for the questionnaire, on the shared journey shell. */
function Flow(p: {
  title: string;
  answered: number;
  total: number;
  level?: number;
  children: React.ReactNode;
  onBack?: () => void;
  onSkipAll?: () => void;
}) {
  return (
    <FlowShell
      level={p.level}
      onBack={p.onBack}
      footer={
        p.onSkipAll ? (
          <div className="flex items-center justify-between gap-4">
            <span className="text-[12px] text-muted tabular-nums">
              {p.answered} of {p.total} answered
            </span>
            <button
              onClick={p.onSkipAll}
              className="rounded-[10px] px-2 py-1 text-[13px] font-semibold text-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-red focus-visible:outline-none"
            >
              Skip to review
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="flex items-center gap-3 pt-1 pb-5">
        <ProgressRing value={p.answered} max={p.total} size={38} stroke={3}>
          {p.answered}
        </ProgressRing>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink">{p.title}</p>
          <p className="text-[12px] text-muted">
            {p.answered >= MIN ? "Enough to continue" : `${MIN - p.answered} more to continue`}
          </p>
        </div>
      </div>
      {p.children}
    </FlowShell>
  );
}

function Intro({ total, onStart }: { total: number; onStart: () => void }) {
  return (
    <FlowShell
      footer={
        <Button className="w-full" onClick={onStart}>
          Start <Icon name="arrow-right" size={18} className="text-current" />
        </Button>
      }
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-7 py-10 text-center">
        <span className="relative grid h-[136px] w-[136px] flex-none place-items-center">
          <Orb className="absolute inset-0" />
          <Icon name="microphone" size={42} className="relative z-10 text-white" />
        </span>
        <div className="flex flex-col gap-3">
          <h1 className="text-[30px] leading-[1.08] font-semibold tracking-[-0.03em] text-balance text-ink sm:text-[36px]">
            Tell us how you think.
          </h1>
          <p className="text-[16px] leading-relaxed text-balance text-muted">
            {total} short questions, one at a time. Talk your answers out loud — it's faster than typing, and we learn
            far more from how you actually speak.
          </p>
          <p className="text-[13px] text-graphite-700">Answer at least {MIN}. Stop and come back whenever you like.</p>
        </div>
      </div>
    </FlowShell>
  );
}

// ── One question ──────────────────────────────────────────────────────────

function QuestionScreen(p: {
  userId: string;
  q: { key: string; q: string };
  n: number;
  answer?: Answer;
  onPatch: (patch: Partial<Answer>) => void;
  onLevel: (v: number) => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const a = p.answer;
  const [typing, setTyping] = useState(!!a?.text && !a?.audio);
  const [text, setText] = useState(a?.text ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const saved = useRef(a?.text ?? "");

  const saveText = useCallback(async () => {
    if (text === saved.current) return;
    saved.current = text;
    p.onPatch({ text });
    await api(`/api/users/${p.userId}/answers/${p.q.key}`, { method: "PUT", body: { text } }).catch(() => {});
  }, [text, p]);

  /**
   * The recording is stored, then the flow moves on immediately — transcription
   * carries on in the background. Waiting for it here would stall the user on every
   * question for no benefit; the answer already counts as given once audio is saved.
   */
  async function upload(blob: Blob) {
    setUploading(true);
    setErr(null);
    const localUrl = URL.createObjectURL(blob);
    try {
      const form = new FormData();
      form.set("audio", new File([blob], `answer.${extFor(blob.type)}`, { type: blob.type }));
      const res = await fetch(`/api/users/${p.userId}/answers/${p.q.key}/audio`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That recording didn't upload");
      p.onPatch({ audio: localUrl, transcript: null });
      setUploading(false);
      p.onNext();
    } catch (e) {
      URL.revokeObjectURL(localUrl);
      setErr((e as Error).message);
      setUploading(false);
    }
  }

  async function discard() {
    p.onPatch({ audio: null, transcript: null });
    await api(`/api/users/${p.userId}/answers/${p.q.key}/audio`, { method: "DELETE" }).catch(() => {});
  }

  const rec = useRecorder({ onDone: upload });
  const hasAnswer = !!(text.trim() || a?.audio);

  // Publish mic level so the shell's orb reacts to the voice, not just the button.
  const report = p.onLevel;
  useEffect(() => {
    report(rec.state === "recording" ? rec.level : 0);
    return () => report(0);
  }, [rec.level, rec.state, report]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 py-6">
      <div className="flex flex-col gap-3">
        <span className="text-[12px] font-bold tracking-wide text-red-text uppercase">Question {p.n}</span>
        <h2 className="text-[24px] leading-tight font-semibold text-balance text-ink sm:text-[28px]">{p.q.q}</h2>
      </div>

      {a?.audio ? (
        <RecordedAnswer answer={a} onDiscard={discard} />
      ) : typing ? (
        <div className="flex flex-col gap-3">
          <Textarea
            autoFocus
            rows={6}
            value={text}
            placeholder="Type your answer…"
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
            className="min-h-40 text-[16px]"
          />
          <button onClick={() => setTyping(false)} className="self-start text-[13px] font-semibold text-red-text">
            <Icon name="microphone" size={15} className="mr-1 inline text-current" />
            Record it instead
          </button>
        </div>
      ) : (
        <MicPanel rec={rec} uploading={uploading} onType={() => setTyping(true)} />
      )}

      {err && (
        <p className="rounded-[16px] bg-blush-50 px-4 py-3 text-[13px] text-red-text">
          {err}{" "}
          <button className="font-semibold underline" onClick={() => setErr(null)}>
            Try again
          </button>
        </p>
      )}

      <div className="mt-auto flex items-center gap-3 pt-4">
        <Button
          className="flex-1"
          variant={hasAnswer ? "primary" : "ghost"}
          disabled={rec.state === "recording" || uploading}
          onClick={async () => {
            await saveText();
            p.onNext();
          }}
        >
          {hasAnswer ? (p.isLast ? "Done" : "Next") : "Skip this one"} <Icon name="arrow-right" size={18} className="text-current" />
        </Button>
      </div>
    </div>
  );
}

/** The recording control, sized for a thumb and showing that the mic is live. */
function MicPanel({ rec, uploading, onType }: { rec: ReturnType<typeof useRecorder>; uploading: boolean; onType: () => void }) {
  const recording = rec.state === "recording";
  const blocked = rec.state === "denied" || rec.state === "unsupported";

  if (blocked)
    return (
      <Card className="my-auto flex flex-col items-center gap-3 py-10 text-center">
        <Icon name="warning-circle" size={28} className="text-red" />
        <p className="text-[15px] font-semibold text-ink">
          {rec.state === "denied" ? "Microphone blocked" : "This browser can't record"}
        </p>
        <p className="max-w-xs text-[14px] text-muted">
          {rec.state === "denied"
            ? "Allow microphone access in your browser settings, or type your answer instead."
            : "Type your answer instead — it works just as well."}
        </p>
        <Button variant="secondary" onClick={onType}>
          Type my answer
        </Button>
      </Card>
    );

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6">
      <button
        type="button"
        disabled={uploading}
        onClick={recording ? rec.stop : rec.start}
        aria-label={recording ? "Stop recording" : "Start recording"}
        className={cx(
          "relative grid h-[164px] w-[164px] place-items-center rounded-full transition-transform duration-200",
          "active:scale-95 disabled:opacity-60",
          "focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none",
        )}
      >
        <Orb level={recording ? rec.level : 0} className="absolute inset-0" />
        <Icon name={recording ? "stop" : "microphone"} size={46} className="relative z-10 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]" />
      </button>

      <div className="text-center">
        {uploading ? (
          <p className="text-[15px] font-semibold text-ink">Saving…</p>
        ) : recording ? (
          <>
            <p className="text-[20px] font-bold text-ink tabular-nums">{clock(rec.secs)}</p>
            <p className="text-[13px] text-muted">
              {rec.remaining <= 30 ? `${rec.remaining}s left — tap to stop` : "Tap to stop when you're done"}
            </p>
          </>
        ) : (
          <>
            <p className="text-[15px] font-semibold text-ink">Tap to record your answer</p>
            <p className="text-[13px] text-muted">Up to {Math.round(rec.maxSeconds / 60)} minutes. Speak naturally.</p>
          </>
        )}
      </div>

      {!recording && !uploading && (
        <button onClick={onType} className="text-[13px] font-semibold text-red-text">
          <Icon name="note-pencil" size={15} className="mr-1 inline text-current" />
          Type it instead
        </button>
      )}
    </div>
  );
}

function RecordedAnswer({ answer, onDiscard }: { answer: Answer; onDiscard: () => void }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-red">
          <Icon name="check" size={20} className="text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">Answer recorded</p>
          <p className="text-[13px] text-muted">{answer.transcript ? "Transcribed" : "Transcribing in the background…"}</p>
        </div>
        <button onClick={onDiscard} aria-label="Discard recording" className="grid h-10 w-10 flex-none place-items-center rounded-full text-muted hover:bg-blush-50 hover:text-red-text">
          <Icon name="trash" size={18} className="text-current" />
        </button>
      </div>
      {answer.audio && <audio src={answer.audio} controls className="h-10 w-full" />}
      {answer.transcript && (
        <div className="rounded-[16px] bg-blush-50 px-4 py-3">
          <Label>Transcript</Label>
          <p className="mt-1 text-[14px] text-ink-soft">{answer.transcript}</p>
        </div>
      )}
    </Card>
  );
}

// ── Review and finish ─────────────────────────────────────────────────────

function Review(p: {
  questions: { key: string; q: string }[];
  answers: Record<string, Answer>;
  userId: string;
  editable: boolean;
  onJump: (i: number) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-xl py-4">
      <ul className="flex flex-col gap-2">
        {p.questions.map((q, i) => {
          const a = p.answers[q.key];
          const done = answeredQ(a);
          const waiting = !!a?.audio && !a?.transcript;
          const body = a?.transcript ?? a?.text ?? "";
          return (
            <li key={q.key}>
              <button
                onClick={() => p.editable && p.onJump(i)}
                disabled={!p.editable}
                className={cx(
                  "flex w-full items-start gap-3 rounded-[16px] px-4 py-3 text-left transition-colors",
                  p.editable && "hover:bg-blush-50",
                )}
              >
                <span
                  className={cx(
                    "mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full text-[12px] font-bold",
                    done ? "bg-red text-white" : "bg-blush-100 text-red-text",
                  )}
                >
                  {done ? <Icon name="check" size={14} className="text-white" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-ink">{q.q}</span>
                  {body ? (
                    <span className="mt-0.5 line-clamp-2 text-[13px] text-muted">{body}</span>
                  ) : waiting ? (
                    <span className="mt-0.5 block text-[13px] text-muted">Voice note saved · transcribing…</span>
                  ) : (
                    <span className="mt-0.5 block text-[13px] text-graphite-500">Not answered yet</span>
                  )}
                </span>
                {p.editable && <Icon name="caret-right" size={16} className="mt-1 flex-none text-graphite-300" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Completing step 3 is refused server-side while a transcript is outstanding. That
 * is the right invariant, so this waits it out visibly instead of surfacing it as
 * an error — by this point the recordings made earlier have usually finished.
 */
function Finish({ userId, answered, pending }: { userId: string; answered: number; pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const enough = answered >= MIN;

  return (
    <div className="mx-auto w-full max-w-xl pt-6">
      {err && <p className="mb-4 rounded-[16px] bg-blush-50 px-4 py-3 text-[14px] text-red-text">{err}</p>}
      <Button
        className="w-full"
        disabled={!enough || busy || pending > 0}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await api(`/api/users/${userId}/onboarding/step`, { body: { step: 3 } });
            router.push("/onboarding/persona");
            router.refresh();
          } catch (e) {
            setErr((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Building…" : "Build my persona"}
        <Icon name="sparkle" size={18} className="text-current" />
      </Button>
      <p className="mt-3 text-center text-[13px] text-muted">
        {pending > 0
          ? `Finishing ${pending} voice note${pending > 1 ? "s" : ""}…`
          : enough
            ? `${answered} answers ready`
            : `Answer ${MIN - answered} more to continue`}
      </p>
    </div>
  );
}

// ── Preferences and samples ───────────────────────────────────────────────

function Slider({ label, left, right, value, onChange }: { label: string; left: string; right: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[14px] font-semibold text-ink">{label}</span>
      <input type="range" min={0} max={1} step={0.1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-6 accent-[var(--red)]" />
      <span className="flex justify-between text-[12px] text-muted">
        <span>{left}</span>
        <span>{right}</span>
      </span>
    </label>
  );
}

function Choice({ label, options, value, onChange }: { label: string; options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] font-semibold text-ink">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button
            type="button"
            key={v}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cx(
              "h-11 rounded-[16px] px-4 text-[14px] font-medium transition-colors",
              value === v ? "bg-red text-white" : "bg-blush-50 text-ink-soft hover:bg-blush-100",
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToneSliders({ userId, initial, onDone }: { userId: string; initial: Record<string, string>; onDone: () => void }) {
  const [v, setV] = useState({
    "pref.formality": initial["pref.formality"] || "0.5",
    "pref.personal": initial["pref.personal"] || "0.5",
    "pref.length": initial["pref.length"] || "medium",
    "pref.emoji": initial["pref.emoji"] || "rare",
    "pref.hashtags": initial["pref.hashtags"] || "max 3, at end",
  });
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    // Persist the defaults once so the persona always has preferences to work from.
    if (Object.keys(initial).every((k) => !initial[k]))
      Object.entries(v).forEach(([k, val]) => api(`/api/users/${userId}/answers/${k}`, { method: "PUT", body: { text: val } }).catch(() => {}));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof v) => (val: string | number) => {
    const s = String(val);
    setV((prev) => ({ ...prev, [k]: s }));
    api(`/api/users/${userId}/answers/${k}`, { method: "PUT", body: { text: s } }).catch(() => {});
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 py-6">
      <div>
        <h2 className="text-[24px] leading-tight font-semibold text-ink sm:text-[28px]">How should it sound?</h2>
        <p className="mt-2 text-[15px] text-muted">You can change any of this later.</p>
      </div>
      <Card className="flex flex-col gap-7">
        <Slider label="Formality" left="Conversational" right="Formal" value={Number(v["pref.formality"])} onChange={set("pref.formality")} />
        <Slider label="Openness" left="Reserved" right="Personal" value={Number(v["pref.personal"])} onChange={set("pref.personal")} />
        <Choice label="Length" value={v["pref.length"]} onChange={set("pref.length")} options={[["short", "Concise"], ["medium", "Medium"], ["long", "Detailed"]]} />
        <Choice label="Emoji" value={v["pref.emoji"]} onChange={set("pref.emoji")} options={[["none", "Never"], ["rare", "Rarely"], ["some", "Sometimes"]]} />
        <Choice
          label="Hashtags"
          value={v["pref.hashtags"]}
          onChange={set("pref.hashtags")}
          options={[["none", "None"], ["max 3, at end", "Up to 3"], ["3 to 5, at end", "3 to 5"]]}
        />
      </Card>
      <Button className="mt-auto w-full" onClick={onDone}>
        Continue <Icon name="arrow-right" size={18} className="text-current" />
      </Button>
    </div>
  );
}

function Samples({ userId, initial, onDone }: { userId: string; initial: Sample[]; onDone: () => void }) {
  const [samples, setSamples] = useState(initial);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function add() {
    setErr(null);
    try {
      const { sample } = await api<{ sample: Sample }>(`/api/users/${userId}/samples`, { body: { text, source: "paste" } });
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
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 py-6">
      <div>
        <h2 className="text-[24px] leading-tight font-semibold text-ink sm:text-[28px]">Anything you've written?</h2>
        <p className="mt-2 text-[15px] text-muted">
          Past posts, a speech, an email. These teach the persona your real voice — optional, but they help a lot.
        </p>
      </div>

      {samples.map((s) => (
        <div key={s.id} className="flex items-start gap-3 rounded-[16px] bg-blush-50 px-4 py-3">
          <Icon name="note-pencil" size={18} className="mt-0.5 flex-none text-red" />
          <p className="line-clamp-2 flex-1 text-[14px] text-ink-soft">{s.text}</p>
          <button
            aria-label="Remove sample"
            className="flex-none text-muted hover:text-red-text"
            onClick={async () => {
              await api(`/api/users/${userId}/samples/${s.id}`, { method: "DELETE" }).catch(() => {});
              setSamples(samples.filter((x) => x.id !== s.id));
            }}
          >
            <Icon name="trash" size={18} className="text-current" />
          </button>
        </div>
      ))}

      {samples.length < 10 && (
        <div className="flex flex-col gap-3">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a post, speech or email…" className="min-h-32" />
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
        </div>
      )}

      <Button className="mt-auto w-full" onClick={onDone}>
        {samples.length ? "Continue" : "Skip for now"} <Icon name="arrow-right" size={18} className="text-current" />
      </Button>
    </div>
  );
}
