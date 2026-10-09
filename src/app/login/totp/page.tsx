"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Eyebrow, Field, Input, Logo, Notice, TwoToneTitle } from "@/components/ui";

export default function TotpPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { next } = await api<{ next: string }>("/api/auth/totp", { body: { code } });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="wash-bottom flex min-h-screen flex-col">
      <div className="flex justify-end px-6 py-6 sm:px-14">
        <Logo height={40} />
      </div>
      <form onSubmit={submit} className="mx-6 flex max-w-md flex-col gap-6 sm:mx-14">
        <Eyebrow>Two-factor check</Eyebrow>
        <TwoToneTitle lead="One more" accent="step." />
        <p className="lead">Enter the 6-digit code from your authenticator app.</p>
        {error && <Notice tone="alert">{error}</Notice>}
        <Field label="Authenticator code">
          <Input inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Button disabled={busy || code.length !== 6}>Verify</Button>
      </form>
    </main>
  );
}
