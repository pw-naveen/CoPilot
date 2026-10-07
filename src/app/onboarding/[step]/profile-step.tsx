"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Card, Field, Input, PageHeader, Select, cx } from "@/components/ui";
import { ContinueBar, ReviewOnly } from "./step-common";

type U = { id: string; name: string; displayName: string; title: string | null; org: string | null; specialty: string | null; linkedinUrl: string | null; languages: string[]; timezone: string };

const LANGS = [
  { v: "en", l: "English" },
  { v: "ms", l: "Bahasa Malaysia" },
  { v: "mixed", l: "Mixed" },
];
const ZONES = ["Asia/Kuala_Lumpur", "Asia/Singapore", "Asia/Jakarta", "Asia/Bangkok", "Asia/Hong_Kong", "Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York", "Australia/Sydney"];

export function ProfileStep({ user, editable }: { user: U; editable: boolean }) {
  const [f, setF] = useState({
    name: user.name,
    displayName: user.displayName,
    title: user.title ?? "",
    org: user.org ?? "",
    specialty: user.specialty ?? "",
    linkedinUrl: user.linkedinUrl ?? "",
    languages: user.languages,
    timezone: user.timezone,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <PageHeader eyebrow="Step 1 · Profile" lead="First, the basics" accent="you sign with." intro="This is how you'll appear on drafts and in the persona. It takes a minute." />
      {!editable && <div className="mb-6"><ReviewOnly /></div>}
      <Card>
        <fieldset disabled={!editable} className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name"><Input value={f.name} onChange={set("name")} /></Field>
          <Field label="Display name" hint="How you sign posts, e.g. Dr Nanda"><Input value={f.displayName} onChange={set("displayName")} /></Field>
          <Field label="Title"><Input value={f.title} onChange={set("title")} placeholder="Director" /></Field>
          <Field label="Organisation"><Input value={f.org} onChange={set("org")} placeholder="Mediwira" /></Field>
          <Field label="Specialty"><Input value={f.specialty} onChange={set("specialty")} placeholder="Cardiology" /></Field>
          <Field label="LinkedIn profile URL"><Input value={f.linkedinUrl} onChange={set("linkedinUrl")} placeholder="https://www.linkedin.com/in/…" /></Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink">Languages you post in</span>
            <div className="flex flex-wrap gap-2">
              {LANGS.map((l) => {
                const on = f.languages.includes(l.v);
                return (
                  <button
                    type="button"
                    key={l.v}
                    aria-pressed={on}
                    onClick={() => setF({ ...f, languages: on ? f.languages.filter((x) => x !== l.v) : [...f.languages, l.v] })}
                    className={cx("h-11 rounded-[16px] px-4 text-[14px] font-medium", on ? "bg-red text-white" : "bg-blush-50 text-ink-soft hover:bg-blush-100")}
                  >
                    {l.l}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Time zone">
            <Select value={f.timezone} onChange={set("timezone")}>
              {[...new Set([f.timezone, ...ZONES])].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          </Field>
        </fieldset>
      </Card>
      {editable && (
        <ContinueBar
          userId={user.id}
          step={2}
          disabled={!f.displayName || !f.languages.length}
          before={async () => {
            await api(`/api/users/${user.id}/profile`, { method: "PUT", body: f });
          }}
        />
      )}
    </>
  );
}
