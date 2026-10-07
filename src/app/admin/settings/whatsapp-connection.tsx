"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { api, waitForJob } from "@/lib/api";
import { Button, Card, Icon, Label, Notice, cx } from "@/components/ui";

type Status = { state: string; qr?: string | null; detail?: string; checkedAt: string; gateway: string } | null;
type Data = { gateway: string; status: Status; webhookUrl: string; unknown: { id: string; phoneE164: string; body: string | null; createdAt: string }[] };

export function WhatsAppConnection() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => setD(await api<Data>("/api/admin/whatsapp"));
  useEffect(() => {
    load();
  }, []);

  async function act(action: "check" | "register_webhook") {
    setBusy(action);
    setErr(null);
    try {
      const { jobId } = await api("/api/admin/whatsapp", { body: { action } });
      await waitForJob(jobId, { timeoutMs: 60_000 });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!d) return <Card className="text-muted">Loading WhatsApp status…</Card>;
  const state = d.status?.state ?? "unknown";
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="card-title">WhatsApp connection</h2>
          <p className="text-[13px] text-muted">Gateway: {d.gateway === "mock" ? "MockGateway (development)" : "Evolution API"}</p>
        </div>
        <span className={cx("inline-flex h-7 items-center gap-1.5 rounded-[16px] px-3 text-[12px] font-semibold", state === "open" ? "bg-red text-white" : "bg-blush-100 text-ink")}>
          <Icon name={state === "open" ? "check-circle" : "warning"} size={14} className="text-current" />
          {state === "open" ? "Connected" : state === "unknown" ? "Not checked" : state}
        </span>
      </div>
      {err && <Notice tone="alert">{err}</Notice>}
      {d.status?.detail && <Notice tone="alert">{d.status.detail}</Notice>}
      {d.status?.qr && state !== "open" && (
        <div>
          <Label>Scan to pair</Label>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.status.qr} alt="WhatsApp pairing QR code" className="mt-2 h-52 w-52" />
          <p className="text-[12px] text-muted">On the dedicated phone: WhatsApp → Linked devices → Link a device.</p>
        </div>
      )}
      <div>
        <Label>Webhook URL</Label>
        <code className="mt-1 block break-all rounded-[12px] bg-blush-50 px-3 py-2 text-[12px]">{d.webhookUrl}</code>
      </div>
      {d.status?.checkedAt && <p className="text-[12px] text-muted">Last checked {DateTime.fromISO(d.status.checkedAt).toRelative()}. The worker checks every 5 minutes and emails admins if the session drops.</p>}
      <div className="flex flex-wrap gap-3">
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act("check")}>
          {busy === "check" ? "Checking…" : "Check connection"}
        </Button>
        {d.gateway === "evolution" && (
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act("register_webhook")}>
            {busy === "register_webhook" ? "Registering…" : "Register webhook"}
          </Button>
        )}
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
