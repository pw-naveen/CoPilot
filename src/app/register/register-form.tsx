"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Field, Icon, Input, Notice, Orb } from "@/components/ui";

const MIN_PASSWORD = 10;

export function RegisterForm() {
  const [v, setV] = useState({ name: "", email: "", password: "", company: "", phone: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const ready =
    v.name.trim().length > 1 && v.email.includes("@") && v.password.length >= MIN_PASSWORD && v.company.trim() && v.phone.trim().length > 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/register", { body: v });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="rise mx-auto w-full max-w-sm text-center">
        <div className="flex flex-col items-center gap-5">
          <Orb size={88} icon="check" />
          <h1 className="text-[28px] leading-tight font-bold text-ink">You're on the list</h1>
          <p className="text-[15px] text-muted">
            Your account is waiting for an administrator to approve it. We'll email{" "}
            <span className="font-semibold text-ink">{v.email}</span> the moment it's ready.
          </p>
          <Link href="/login" className="link text-[14px]">
            Back to sign in
          </Link>
        </div>
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rise flex flex-col items-center gap-5 text-center">
        <Orb size={80} icon="sparkle" />
        <div>
          <h1 className="text-[28px] leading-tight font-bold text-ink">Create your account</h1>
          <p className="mt-1.5 text-[15px] text-muted">An administrator approves new accounts before first sign-in.</p>
        </div>
      </div>

      <form onSubmit={submit} className="rise mt-8 flex flex-col gap-4" style={{ animationDelay: "80ms" }}>
        {error && <Notice tone="alert">{error}</Notice>}
        <Field label="Full name">
          <Input required autoFocus autoComplete="name" value={v.name} onChange={set("name")} placeholder="Dr Nanda Kumar" />
        </Field>
        <Field label="Work email">
          <Input type="email" required autoComplete="email" value={v.email} onChange={set("email")} placeholder="you@company.com" />
        </Field>
        <Field label="Company">
          <Input required autoComplete="organization" value={v.company} onChange={set("company")} placeholder="Mediwira" />
        </Field>
        <Field label="WhatsApp number" hint="International format — this is where drafts arrive for approval.">
          <Input
            type="tel"
            required
            autoComplete="tel"
            value={v.phone}
            onChange={set("phone")}
            placeholder="+60123456789"
          />
        </Field>
        <Field label="Password" htmlFor="register-password" hint={`At least ${MIN_PASSWORD} characters.`}>
          <div className="relative">
            <Input
              id="register-password"
              type={show ? "text" : "password"}
              required
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              value={v.password}
              onChange={set("password")}
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
        <Button type="submit" disabled={busy || !ready} className="mt-1 w-full">
          {busy ? "Creating…" : "Create account"}
          {!busy && <Icon name="arrow-right" size={18} className="text-current" />}
        </Button>
      </form>

      <p className="mt-6 text-center text-[14px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="link">
          Sign in
        </Link>
      </p>
    </div>
  );
}
