"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, waitForJob } from "@/lib/api";
import { LinkedInPreview } from "@/components/linkedin-preview";
import { Button, Card, Icon, IconCircle, Label, Notice, PageHeader, Textarea, cx } from "@/components/ui";
import { ReviewOnly } from "./step-common";

type Sample = { id: string; kind: string; text: string; verdict: string | null; comment: string | null; rounds: number; updatedAt: string };

const TITLES: Record<string, string> = {
  professional_insight: "A professional insight",
  personal_reflection: "A personal reflection",
  event_milestone: "An event or milestone",
};

export function ToneStep(p: { userId: string; editable: boolean; kinds: { kind: string; prompt: string }[]; samples: Sample[]; displayName: string; title: string }) {
  const router = useRouter();
  const missing = p.samples.length < p.kinds.length;
  const rewriting = p.samples.some((s) => s.verdict === "close" || s.verdict === "not_me");
  const approved = p.samples.filter((s) => s.verdict === "sounds_like_me").length;

  // While the worker writes or rewrites samples, keep the page fresh.
  useEffect(() => {
    if (!missing && !rewriting) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [missing, rewriting, router]);

  return (
    <>
      <PageHeader
        eyebrow="Step 4 · Tone check"
        lead="Three posts."
        accent="Do they sound like you?"
        intro="Mark each one. If it's close or off, say why: your comment updates the persona and the post is rewritten."
      />
      {!p.editable && <div className="mb-6"><ReviewOnly /></div>}
      {missing ? (
        <Card className="flex flex-col items-center gap-4 py-16 text-center">
          <IconCircle name="note-pencil" />
          <p className="card-title">Writing your samples</p>
          <p className="text-muted">One professional insight, one personal reflection, one milestone.</p>
          <RetryAfter userId={p.userId} />
        </Card>
      ) : (
        <>
          <p className="mb-6 text-[14px] font-semibold text-ink">
            {approved} of {p.kinds.length} sound like you
          </p>
          <div className="grid gap-8 lg:grid-cols-3">
            {p.kinds.map((k) => {
              const s = p.samples.find((x) => x.kind === k.kind)!;
              return <SampleCard key={k.kind} userId={p.userId} sample={s} editable={p.editable} displayName={p.displayName} headline={p.title} />;
            })}
          </div>
        </>
      )}
    </>
  );
}

function RetryAfter({ userId }: { userId: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 45_000);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <Button size="sm" variant="secondary" onClick={() => api(`/api/users/${userId}/tone`, { method: "POST" })}>
      Taking a while? Try again
    </Button>
  );
}

function SampleCard({ userId, sample, editable, displayName, headline }: { userId: string; sample: Sample; editable: boolean; displayName: string; headline: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "close" | "not_me">(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rewriting = sample.verdict === "close" || sample.verdict === "not_me";
  const ok = sample.verdict === "sounds_like_me";

  async function send(verdict: "sounds_like_me" | "close" | "not_me") {
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ done: boolean; jobId?: string }>(`/api/users/${userId}/tone/${sample.id}`, { body: { verdict, comment } });
      setMode(null);
      setComment("");
      if (res.jobId) {
        router.refresh();
        await waitForJob(res.jobId);
      }
      if (res.done) router.push("/onboarding/cadence");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Label>{TITLES[sample.kind] ?? sample.kind}</Label>
        {sample.rounds > 0 && <span className="text-[12px] text-muted">Revision {sample.rounds}</span>}
      </div>
      <div className={cx("relative transition-opacity", rewriting && "opacity-40")}>
        <LinkedInPreview name={displayName} headline={headline} text={sample.text} when="Sample" />
        {ok && (
          <span className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full bg-red shadow-disc" title="Sounds like me">
            <Icon name="check" size={18} className="text-white" />
          </span>
        )}
      </div>
      {rewriting ? (
        <Notice>Rewriting with your note: “{sample.comment}”</Notice>
      ) : (
        editable && (
          <>
            {err && <Notice tone="alert">{err}</Notice>}
            {mode ? (
              <div className="flex flex-col gap-3">
                <Textarea
                  autoFocus
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={mode === "close" ? "What would you change? e.g. shorter opening, less formal" : "What feels wrong? e.g. I'd never talk about myself like this"}
                />
                <div className="flex gap-2">
                  <Button size="sm" disabled={!comment.trim() || busy} onClick={() => send(mode)}>
                    {busy ? "Sending…" : "Rewrite it"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={ok ? "secondary" : "primary"} disabled={busy || ok} onClick={() => send("sounds_like_me")}>
                  Sounds like me
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("close")}>
                  Close, adjust
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("not_me")}>
                  Not me
                </Button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
