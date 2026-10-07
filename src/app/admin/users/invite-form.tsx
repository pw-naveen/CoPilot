"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Field, Input, Notice } from "@/components/ui";

export function InviteUserForm() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", title: "", email: "", phone: "+60" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "alert"; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/users", { body: { ...f, phone: f.phone.replace(/[\s-]/g, "") } });
      setMsg({ tone: "info", text: `Invite sent to ${f.email}.` });
      setF({ name: "", title: "", email: "", phone: "+60" });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "alert", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Field label="Full name">
        <Input required value={f.name} onChange={set("name")} placeholder="Dr Nanda Kumar" />
      </Field>
      <Field label="Title">
        <Input value={f.title} onChange={set("title")} placeholder="Director" />
      </Field>
      <Field label="Email">
        <Input type="email" required value={f.email} onChange={set("email")} />
      </Field>
      <Field label="WhatsApp number" hint="International format, e.g. +60123456789">
        <Input required value={f.phone} onChange={set("phone")} inputMode="tel" />
      </Field>
      <Button disabled={busy}>{busy ? "Sending…" : "Send invite"}</Button>
    </form>
  );
}
