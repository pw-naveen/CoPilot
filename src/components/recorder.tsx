"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, cx } from "./ui";

export type RecState = "idle" | "recording" | "denied" | "unsupported";

/** Safari produces mp4/aac and has never supported webm; pick what the browser admits to. */
const MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg;codecs=opus"];

function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  return MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

/** File extension matching the blob, so the transcription API gets a name it recognises. */
export function extFor(mime: string) {
  if (mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

/**
 * Microphone recording with the things phones need: a format the browser actually
 * supports, a hard length cap so an upload can't exceed the server's limit, a live
 * level so the user can see it is listening, and a clean stop if the page is hidden
 * (iOS tears down the recorder when the screen locks).
 */
export function useRecorder({ onDone, maxSeconds = 180 }: { onDone: (blob: Blob) => void; maxSeconds?: number }) {
  const [state, setState] = useState<RecState>("idle");
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);

  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const teardown = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    timer.current = null;
    raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") rec.current.stop();
    else teardown();
    setState("idle");
  }, [teardown]);

  const start = useCallback(async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return setState("unsupported");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const mime = pickMime();
      const r = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        const type = r.mimeType || mime || "audio/webm";
        teardown();
        if (chunks.length) done.current(new Blob(chunks, { type }));
      };
      r.start();
      rec.current = r;
      setSecs(0);
      setState("recording");

      timer.current = setInterval(() => {
        setSecs((n) => {
          if (n + 1 >= maxSeconds) stop();
          return n + 1;
        });
      }, 1000);

      // Live input level, purely for feedback that the mic is live.
      try {
        const ctx = new (window.AudioContext || (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        audioCtx.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setLevel(peak);
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        /* level metering is optional */
      }
    } catch {
      teardown();
      setState("denied");
    }
  }, [maxSeconds, stop, teardown]);

  // iOS stops delivering audio when the page is hidden; close out rather than keep a dead recorder.
  useEffect(() => {
    const onHide = () => document.hidden && rec.current?.state === "recording" && stop();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [stop]);

  useEffect(() => () => teardown(), [teardown]);

  return { state, secs, level, start, stop, remaining: maxSeconds - secs, maxSeconds, reset: () => setState("idle") };
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Compact inline record button, for places where typing is the main event. */
export function Recorder({ onDone, disabled, label = "Record" }: { onDone: (blob: Blob) => void; disabled?: boolean; label?: string }) {
  const r = useRecorder({ onDone });
  if (r.state === "denied") return <span className="text-[13px] text-muted">Microphone blocked. Allow it in your browser to record.</span>;
  if (r.state === "unsupported") return <span className="text-[13px] text-muted">This browser can't record audio. Type your answer instead.</span>;
  const recording = r.state === "recording";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={recording ? r.stop : r.start}
      className={cx(
        "inline-flex h-9 items-center gap-2 rounded-[16px] px-3 text-[13px] font-semibold transition-colors disabled:opacity-50",
        recording ? "bg-red text-white" : "bg-blush-50 text-red-text hover:bg-blush-100",
      )}
    >
      <Icon name={recording ? "stop" : "microphone"} size={18} className="text-current" />
      {recording ? `Stop · ${clock(r.secs)}` : label}
    </button>
  );
}
