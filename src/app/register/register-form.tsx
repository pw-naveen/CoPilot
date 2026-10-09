"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Field, Icon, Input, Notice, Select } from "@/components/ui";
import { Orb } from "@/components/orb";

const MIN_PASSWORD = 10;
/** The option that reveals the free-text company field. */
const OTHER = "other";

export type Org = { id: string; name: string };

export function RegisterForm({ organizations = [] }: { organizations?: Org[] }) {
  const [v, setV] = useState({ name: "", email: "", password: "", company: "", phone: "" });
  // An admin's list should not be able to block a sign-up, so "not listed"
  // always exists and falls back to the typed company name.
  const [orgId, setOrgId] = useState(organizations.length ? "" : OTHER);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"form" | "verify" | "done">("form");
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const orgChosen = orgId === OTHER ? !!v.company.trim() : !!orgId;
  const ready =
    v.name.trim().length > 1 && v.email.includes("@") && v.password.length >= MIN_PASSWORD && orgChosen && v.phone.trim().length > 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/register", {
        body: orgId && orgId !== OTHER ? { ...v, company: "", organizationId: orgId } : v,
      });
      setStage("verify");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (stage === "verify")
    return (
      <div className="rise mx-auto w-full max-w-sm">
        <div className="flex flex-col items-center gap-5 text-center">
          <span className="relative grid h-[88px] w-[88px] flex-none place-items-center">
            <Orb className="absolute inset-0" />
            <Icon name="whatsapp-logo" size={34} className="relative z-10 text-white" />
          </span>
          <div>
            <h1 className="text-[26px] leading-tight font-bold text-ink">Check WhatsApp</h1>
            <p className="mt-1.5 text-[15px] text-muted">
              We sent a 6-digit code to <span className="font-semibold text-ink">{v.phone}</span>.
            </p>
          </div>
        </div>

        <form
          className="mt-7 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api("/api/auth/whatsapp", { body: { email: v.email, code } });
              setStage("done");
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <Notice tone="alert">{error}</Notice>}
          <Field label="Verification code" htmlFor="wa-code">
            <Input
              id="wa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="text-center text-[20px] tracking-[0.4em] tabular-nums"
            />
          </Field>
          <Button type="submit" disabled={busy || code.length < 4} className="w-full">
            {busy ? "Checking…" : "Verify number"}
          </Button>
        </form>

        <div className="mt-5 flex flex-col items-center gap-2 text-[13px]">
          <button
            disabled={busy || resent}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                await api("/api/auth/whatsapp", { body: { email: v.email, resend: true } });
                setResent(true);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="font-semibold text-red-text disabled:opacity-50"
          >
            {resent ? "Code sent again" : "Send another code"}
          </button>
          <button onClick={() => setStage("form")} className="text-muted hover:text-ink">
            Wrong number? Go back
          </button>
        </div>
      </div>
    );

  if (stage === "done")
    return (
      <div className="rise mx-auto w-full max-w-sm text-center">
        <div className="flex flex-col items-center gap-5">
          <span className="relative grid h-[104px] w-[104px] flex-none place-items-center">
            <Orb className="absolute inset-0" />
            <Icon name="check" size={36} className="relative z-10 text-white" />
          </span>
          <h1 className="text-[28px] leading-tight font-bold text-ink">Number confirmed</h1>
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
        <span className="relative grid h-[88px] w-[88px] flex-none place-items-center">
          <Orb className="absolute inset-0" />
        </span>
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
        {organizations.length > 0 ? (
          <Field label="Organisation" htmlFor="register-org">
            <Select id="register-org" required value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="" disabled>
                Choose your organisation…
              </option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
              <option value={OTHER}>My organisation isn&apos;t listed</option>
            </Select>
          </Field>
        ) : null}
        {(organizations.length === 0 || orgId === OTHER) && (
          <Field label={organizations.length ? "Company name" : "Company"}>
            <Input required autoComplete="organization" value={v.company} onChange={set("company")} placeholder="Mediwira" />
          </Field>
        )}
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
