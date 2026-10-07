"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, Field, Input, Notice } from "@/components/ui";

type Settings = Record<string, { value: string; secret: boolean; set: boolean }>;

const LABELS: Record<string, [string, string?]> = {
  "openai.api_key": ["OpenAI API key"],
  "evolution.url": ["Evolution API base URL", "e.g. https://wa.example.com"],
  "evolution.api_key": ["Evolution API key"],
  "evolution.instance": ["Evolution instance name"],
  "evolution.webhook_secret": ["Webhook shared secret", "Sent by Evolution on every webhook call"],
  "limits.debounce_seconds": ["Message bundling wait (seconds)", "Silence before fragments become one input"],
  "limits.monthly_cap": ["Monthly post cap per user"],
  "limits.input_prompt_days": ["Topic prompt lead time (days)"],
  "defaults.timezone": ["Default time zone"],
  "subadmin.can_invite_default": ["Sub-admins can invite by default", "true or false"],
};

export function GlobalSettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [vals, setVals] = useState(Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v.value])));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await api("/api/admin/settings", { method: "PUT", body: vals });
        setBusy(false);
        setMsg("Saved.");
        router.refresh();
      }}
    >
      {Object.keys(LABELS).map((k) => (
        <Field key={k} label={LABELS[k][0]} hint={LABELS[k][1]}>
          <Input
            type={initial[k]?.secret ? "password" : "text"}
            value={vals[k] ?? ""}
            onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
            onFocus={(e) => initial[k]?.secret && e.target.value.startsWith("••••") && setVals({ ...vals, [k]: "" })}
            autoComplete="off"
          />
        </Field>
      ))}
      {msg && <Notice>{msg}</Notice>}
      <Button disabled={busy}>Save settings</Button>
    </form>
  );
}

export function TotpCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card>
      <h2 className="card-title mb-1">Two-factor sign-in</h2>
      <p className="mb-5 text-[14px] text-muted">
        {enabled ? "On. You'll be asked for an authenticator code after each sign-in." : "Optional. Adds an authenticator-app code after the email link."}
      </p>
      {err && <Notice tone="alert">{err}</Notice>}
      {enabled ? (
        <Button
          variant="danger"
          size="sm"
          onClick={async () => {
            await api("/api/me/totp", { method: "DELETE" });
            router.refresh();
          }}
        >
          Turn off
        </Button>
      ) : setup ? (
        <div className="flex flex-col gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="Authenticator QR code" className="h-44 w-44" />
          <p className="text-[12px] text-muted">
            Or enter this key: <code className="break-all">{setup.secret}</code>
          </p>
          <Field label="Code from the app">
            <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Button
            size="sm"
            disabled={code.length !== 6}
            onClick={async () => {
              try {
                await api("/api/me/totp", { method: "PUT", body: { code } });
                setSetup(null);
                router.refresh();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Confirm
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={async () => setSetup(await api("/api/me/totp", { method: "POST" }))}>
          Set up 2FA
        </Button>
      )}
    </Card>
  );
}
