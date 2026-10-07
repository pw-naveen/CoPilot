"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { Button, Card, Label } from "@/components/ui";

const STEPS: [string, number][] = [
  ["+3 min", 3 * 60_000],
  ["+1 hour", 3600_000],
  ["+6 hours", 6 * 3600_000],
  ["+1 day", 86_400_000],
  ["+2 days", 2 * 86_400_000],
];

export function ClockControls() {
  const [s, setS] = useState<{ now: string; offsetMs: number; jobs?: string[]; result?: unknown } | null>(null);
  const [jobs, setJobs] = useState<string[]>([]);
  const post = async (body: object) => {
    const r = await fetch("/api/dev/clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setS(await r.json());
  };
  useEffect(() => {
    fetch("/api/dev/clock").then(async (r) => {
      const j = await r.json();
      setS(j);
      setJobs(j.jobs);
    });
  }, []);
  if (!s) return null;
  const days = s.offsetMs / 86_400_000;
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Card className="flex flex-col gap-6">
        <div>
          <Label>Scheduler clock</Label>
          <p className="mt-2 text-[32px] font-extrabold text-ink">{DateTime.fromISO(s.now).setZone("Asia/Kuala_Lumpur").toFormat("ccc d LLL, HH:mm")}</p>
          <p className="text-[13px] text-muted">Kuala Lumpur time · offset {days >= 0 ? "+" : ""}{days.toFixed(2)} days</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {STEPS.map(([l, ms]) => (
            <Button key={l} size="sm" variant="secondary" onClick={() => post({ addMs: ms, run: "scheduler.tick" })}>
              {l}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => post({ reset: true })}>
            Back to now
          </Button>
        </div>
        <p className="text-[12px] text-muted">Each jump also runs one scheduler tick.</p>
      </Card>
      <Card className="flex flex-col gap-4">
        <Label>Run a job now</Label>
        <div className="flex flex-wrap gap-2">
          {jobs.map((j) => (
            <Button key={j} size="sm" variant="secondary" onClick={() => post({ run: j })}>
              {j}
            </Button>
          ))}
        </div>
        {s.result !== undefined && <pre className="overflow-x-auto rounded-[16px] bg-blush-50 p-4 text-[12px]">{JSON.stringify(s.result, null, 2)}</pre>}
      </Card>
    </div>
  );
}
