"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { api, waitForJob } from "@/lib/api";
import { Button, Card, Icon, Input, Label, Notice, cx } from "@/components/ui";

type Status = { state: string; qr?: string | null; detail?: string; checkedAt: string; gateway: string } | null;
type Diagnosis = {
  gateway: "evolution" | "mock";
  reason: string;
  target: { url: string | null; instance: string | null; apiKey: boolean; webhookSecret: boolean };
  ok: boolean;
  state: string;
  qr?: string | null;
  detail?: string;
  checkedAt: string;
};
type Data = {
  gateway: "evolution" | "mock";
  reason: string;
  status: Status;
  webhookUrl: string;
  unknown: { id: string; phoneE164: string; body: string | null; createdAt: string }[];
};

export function WhatsAppConnection() {
  const [d, setD] = useState<Data | null>(null);
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => setD(await api<Data>("/api/admin/whatsapp"));
  useEffect(() => {
    load();
  }, []);

  async function act(action: "check" | "register_webhook" | "test_message") {
    setBusy(action);
    setErr(null);
    if (action !== "test_message") setSent(null);
    try {
      const r = await api<{ jobId?: string; diagnosis?: Diagnosis; sent?: { to: string; id: string; gateway: string } }>(
        "/api/admin/whatsapp",
        { body: action === "test_message" ? { action, phone } : { action } },
      );
      if (r.jobId) await waitForJob(r.jobId, { timeoutMs: 60_000 });
      if (r.diagnosis) setDiag(r.diagnosis);
      if (r.sent) setSent(`Sent to ${r.sent.to} via ${r.sent.gateway}${r.sent.id ? ` (id ${r.sent.id})` : ""}.`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!d) return <Card className="text-muted">Loading WhatsApp status…</Card>;
  const state = diag?.state ?? d.status?.state ?? "unknown";
  const live = d.gateway === "evolution";
  const detail = diag?.detail ?? d.status?.detail;
  const qr = diag?.qr ?? d.status?.qr;

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="card-title">WhatsApp connection</h2>
          <p className="text-[13px] text-muted">{live ? "Evolution API" : "Mock gateway — nothing reaches a real phone"}</p>
        </div>
        <span
          className={cx(
            "inline-flex h-7 flex-none items-center gap-1.5 rounded-[16px] px-3 text-[12px] font-semibold",
            state === "open" && live ? "bg-red text-white" : "bg-blush-100 text-ink",
          )}
        >
          <Icon name={state === "open" && live ? "check-circle" : "warning"} size={14} className="text-current" />
          {state === "open" ? (live ? "Connected" : "Mock") : state === "unknown" ? "Not checked" : state}
        </span>
      </div>

      {/* Why this gateway — the question an admin who filled in the form actually has. */}
      {!live && <Notice tone="alert">{d.reason}</Notice>}
      {err && <Notice tone="alert">{err}</Notice>}
      {detail && <Notice tone="alert">{detail}</Notice>}
      {sent && <Notice>{sent}</Notice>}

      {diag && (
        <div>
          <Label>Last check</Label>
          <dl className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-[13px]">
            <dt className="text-muted">Gateway</dt>
            <dd className="text-ink">{diag.gateway}</dd>
            <dt className="text-muted">URL</dt>
            <dd className="break-all text-ink">{diag.target.url ?? "not set"}</dd>
            <dt className="text-muted">Instance</dt>
            <dd className="break-all text-ink">{diag.target.instance ?? "not set"}</dd>
            <dt className="text-muted">API key</dt>
            <dd className={diag.target.apiKey ? "text-ink" : "text-red-text"}>{diag.target.apiKey ? "saved" : "not set"}</dd>
            <dt className="text-muted">Result</dt>
            {/* The mock always reports "open"; saying "connected" next to it
                would read as a passing test of credentials nobody entered. */}
            <dd className={diag.gateway === "mock" ? "text-muted" : diag.ok ? "text-ink" : "text-red-text"}>
              {diag.gateway === "mock" ? "nothing was contacted" : diag.ok ? "connected" : diag.state}
            </dd>
          </dl>
        </div>
      )}

      {qr && state !== "open" && (
        <div>
          <Label>Scan to pair</Label>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="WhatsApp pairing QR code" className="mt-2 h-52 w-52" />
          <p className="text-[12px] text-muted">On the dedicated phone: WhatsApp → Linked devices → Link a device.</p>
        </div>
      )}

      <div>
        <Label>Webhook URL</Label>
        <code className="mt-1 block break-all rounded-[12px] bg-blush-50 px-3 py-2 text-[12px]">{d.webhookUrl}</code>
        <p className="mt-1 text-[12px] text-muted">
          Evolution calls this to deliver replies, so it has to be reachable from wherever Evolution runs. A localhost URL will
          never receive anything.
        </p>
      </div>

      {(diag?.checkedAt ?? d.status?.checkedAt) && (
        <p className="text-[12px] text-muted">
          Last checked {DateTime.fromISO(diag?.checkedAt ?? d.status!.checkedAt).toRelative()}. The worker checks every 5 minutes
          and emails admins if the session drops.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act("check")}>
          {busy === "check" ? "Checking…" : "Check connection"}
        </Button>
        {live && (
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act("register_webhook")}>
            {busy === "register_webhook" ? "Registering…" : "Register webhook"}
          </Button>
        )}
      </div>

      {/* A connection state says the instance is up; only a delivered message
          says it can reach a handset. */}
      <div className="flex flex-col gap-2 border-t border-line pt-5">
        <Label>Send a test message</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+60123456789"
            className="w-56"
            aria-label="Number to send a test message to"
          />
          <Button size="sm" variant="secondary" disabled={!!busy || phone.trim().length < 8} onClick={() => act("test_message")}>
            {busy === "test_message" ? "Sending…" : "Send"}
          </Button>
        </div>
        <p className="text-[12px] text-muted">Goes out immediately through the gateway above — no queue, no quiet hours.</p>
      </div>

      {d.unknown.length > 0 && (
        <div>
          <Label>Messages from unknown numbers</Label>
          <ul className="mt-2 divide-y divide-line text-[13px]">
            {d.unknown.slice(0, 8).map((m) => (
              <li key={m.id} className="flex gap-3 py-2">
                <span className="font-semibold text-ink">{m.phoneE164}</span>
                <span className="flex-1 truncate text-muted">{m.body ?? "(media)"}</span>
                <span className="text-muted">{DateTime.fromISO(m.createdAt).toFormat("d LLL HH:mm")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
