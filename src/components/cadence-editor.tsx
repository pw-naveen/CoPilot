"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { api } from "@/lib/api";
import { Button, Card, Label, Notice, cx } from "./ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type Cadence = { postsPerWeek: number; weekdays: number[]; times: string[] };
type Preview = { publishAt: string; approvalDeadline: string }[];

/** Pick 2 or 4 posts a week, the days and a time per day; previews the next 4 weeks. */
export function CadenceEditor({
  userId,
  timezone,
  initial,
  editable = true,
  saveLabel = "Save cadence",
  onSaved,
}: {
  userId: string;
  timezone: string;
  initial: Cadence | null;
  editable?: boolean;
  saveLabel?: string;
  onSaved?: () => void | Promise<void>;
}) {
  const [c, setC] = useState<Cadence>(initial ?? { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] });
  const [preview, setPreview] = useState<Preview>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const valid = c.weekdays.length === c.postsPerWeek;

  useEffect(() => {
    if (!valid) return setPreview([]);
    const t = setTimeout(async () => {
      try {
        setPreview((await api<{ preview: Preview }>(`/api/users/${userId}/cadence/preview`, { body: c })).preview);
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [c, valid, userId]);

  function toggleDay(d: number) {
    setSaved(false);
    const i = c.weekdays.indexOf(d);
    if (i >= 0) return setC({ ...c, weekdays: c.weekdays.filter((_, j) => j !== i), times: c.times.filter((_, j) => j !== i) });
    if (c.weekdays.length >= c.postsPerWeek) return;
    const pairs = [...c.weekdays.map((w, j) => ({ w, t: c.times[j] })), { w: d, t: c.times[c.times.length - 1] ?? "09:00" }].sort((a, b) => a.w - b.w);
    setC({ ...c, weekdays: pairs.map((p) => p.w), times: pairs.map((p) => p.t) });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/users/${userId}/cadence`, { method: "PUT", body: c });
      setSaved(true);
      await onSaved?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fmt = (iso: string, f: string) => DateTime.fromISO(iso, { zone: timezone }).toFormat(f);
  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="flex flex-col gap-7">
        <div>
          <Label>Posts a week</Label>
          <div className="mt-3 flex gap-3">
            {[2, 4].map((n) => (
              <button
                key={n}
                type="button"
                disabled={!editable}
                aria-pressed={c.postsPerWeek === n}
                onClick={() => {
                  setSaved(false);
                  setC({ postsPerWeek: n, weekdays: c.weekdays.slice(0, n), times: c.times.slice(0, n) });
                }}
                className={cx("flex h-20 w-28 flex-col items-center justify-center rounded-[16px]", c.postsPerWeek === n ? "bg-red text-white shadow-disc" : "bg-blush-50 text-ink hover:bg-blush-100")}
              >
                <span className="text-[28px] leading-none font-extrabold">{n}</span>
                <span className="text-[12px]">a week</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Days</Label>
          <p className="mt-1 text-[13px] text-muted">Pick {c.postsPerWeek}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DAYS.map((d, i) => {
              const on = c.weekdays.includes(i + 1);
              const full = !on && c.weekdays.length >= c.postsPerWeek;
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!editable || full}
                  aria-pressed={on}
                  onClick={() => toggleDay(i + 1)}
                  className={cx("h-11 w-14 rounded-[16px] text-[14px] font-semibold disabled:opacity-40", on ? "bg-red text-white" : "bg-blush-50 text-ink-soft hover:bg-blush-100")}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        {c.weekdays.length > 0 && (
          <div>
            <Label>Time for each</Label>
            <p className="mt-1 text-[13px] text-muted">In {timezone.replace("_", " ")}.</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {c.weekdays.map((w, i) => (
                <label key={w} className="flex items-center gap-3 rounded-[16px] bg-blush-50 px-4 py-2">
                  <span className="w-10 text-[14px] font-semibold text-ink">{DAYS[w - 1]}</span>
                  <input
                    type="time"
                    disabled={!editable}
                    value={c.times[i]}
                    onChange={(e) => {
                      setSaved(false);
                      setC({ ...c, times: c.times.map((t, j) => (j === i ? e.target.value : t)) });
                    }}
                    className="flex-1 bg-transparent text-[14px] text-ink focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>
        )}
        {err && <Notice tone="alert">{err}</Notice>}
        {editable && (
          <div className="flex items-center gap-3">
            <Button disabled={!valid || busy} onClick={save}>
              {busy ? "Saving…" : saveLabel}
            </Button>
            {saved && <span className="text-[13px] text-muted">Saved</span>}
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-line px-6 py-4">
          <p className="card-title">Next 4 weeks</p>
          <p className="text-[13px] text-muted">Each post needs your approval 48 hours before it goes out.</p>
        </div>
        {preview.length === 0 ? (
          <p className="px-6 py-10 text-center text-[14px] text-muted">{valid ? "Loading…" : `Pick ${c.postsPerWeek} days to see your calendar.`}</p>
        ) : (
          <ul className="divide-y divide-line">
            {preview.map((s) => (
              <li key={s.publishAt} className="flex items-center gap-4 px-6 py-3">
                <span className="w-12 flex-none text-center leading-tight">
                  <span className="block text-[11px] font-semibold text-red-text uppercase">{fmt(s.publishAt, "ccc")}</span>
                  <span className="block text-[20px] font-extrabold text-ink">{fmt(s.publishAt, "d")}</span>
                </span>
                <span className="flex-1 text-[14px]">
                  <span className="block font-medium text-ink">{fmt(s.publishAt, "LLL d · HH:mm")}</span>
                  <span className="text-[13px] text-muted">Approve by {fmt(s.approvalDeadline, "ccc LLL d, HH:mm")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
