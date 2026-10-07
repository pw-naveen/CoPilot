"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Eyebrow, Field, Input, Notice, TwoToneTitle } from "@/components/ui";

export function LoginForm({ linkError }: { linkError?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(linkError ? "That link has expired or was already used. Request a new one." : null);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/request", { body: { email } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { next } = await api<{ next: string }>("/api/auth/otp", { body: { email, code } });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="reveal flex w-full max-w-md flex-col gap-8">
      <Eyebrow>Sign in</Eyebrow>
      <TwoToneTitle lead={["Your voice,"]} accent={["on schedule."]} hero />
      {error && <Notice tone="alert">{error}</Notice>}
      {!sent ? (
        <form onSubmit={request} className="flex flex-col gap-5">
          <p className="lead">Enter your email. We'll send a sign-in link and a 6-digit code. No password needed.</p>
          <Field label="Email">
            <Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Button disabled={busy || !email}>{busy ? "Sending…" : "Send sign-in link"}</Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-5">
          <p className="lead">
            If <strong className="font-semibold text-ink">{email}</strong> has an account, a link and code are on their way. Open the link, or type the code here.
          </p>
          <Field label="6-digit code">
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <div className="flex gap-3">
            <Button disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Sign in"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setSent(false); setCode(""); }}>
              Use a different email
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
