"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, cx } from "./ui";

/** Record a voice note in the browser. Calls onDone with the audio blob. */
export function Recorder({ onDone, disabled, label = "Record" }: { onDone: (blob: Blob) => void; disabled?: boolean; label?: string }) {
  const [state, setState] = useState<"idle" | "recording" | "denied">("idle");
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const r = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        onDone(new Blob(chunks, { type: mime }));
      };
      r.start();
      rec.current = r;
      setSecs(0);
      timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
      setState("recording");
    } catch {
      setState("denied");
    }
  }

  function stop() {
    rec.current?.stop();
    if (timer.current) clearInterval(timer.current);
    setState("idle");
  }

  if (state === "denied") return <span className="text-[13px] text-muted">Microphone blocked. Allow it in your browser to record.</span>;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={state === "recording" ? stop : start}
      className={cx(
        "inline-flex h-9 items-center gap-2 rounded-[16px] px-3 text-[13px] font-semibold transition-colors disabled:opacity-50",
        state === "recording" ? "bg-red text-white" : "bg-blush-50 text-red-text hover:bg-blush-100",
      )}
    >
      <Icon name={state === "recording" ? "stop" : "microphone"} size={18} className="text-current" />
      {state === "recording" ? `Stop · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : label}
    </button>
  );
}
