"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Field, Icon, Input, Notice } from "@/components/ui";
import { Orb } from "@/components/orb";

export function LoginForm({ linkError }: { linkError?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError ? "That link has expired or was already used. Sign in with your password." : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { next } = await api<{ next: string }>("/api/auth/login", { body: { email, password } });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rise flex flex-col items-center gap-5 text-center">
        <span className="relative grid h-[112px] w-[112px] flex-none place-items-center">
          <Orb className="absolute inset-0" />
        </span>
        <div>
          <h1 className="text-[28px] leading-tight font-bold text-ink">Welcome back</h1>
          <p className="mt-1.5 text-[15px] text-muted">Sign in to your CoPilot account.</p>
        </div>
      </div>

      <form onSubmit={submit} className="rise mt-8 flex flex-col gap-4" style={{ animationDelay: "80ms" }}>
        {error && <Notice tone="alert">{error}</Notice>}
        <Field label="Email">
          <Input
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <div className="relative">
            <Input
              id="login-password"
              type={show ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="pr-11"
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-red-text"
            >
              <Icon name={show ? "eye-slash" : "eye"} size={18} className="text-current" />
            </button>
          </div>
        </Field>
        <Button type="submit" disabled={busy || !email || !password} className="mt-1 w-full">
          {busy ? "Signing in…" : "Sign in"}
          {!busy && <Icon name="arrow-right" size={18} className="text-current" />}
        </Button>
      </form>

      <p className="mt-6 text-center text-[14px] text-muted">
        No account yet?{" "}
        <Link href="/register" className="link">
          Create one
        </Link>
      </p>
    </div>
  );
}
