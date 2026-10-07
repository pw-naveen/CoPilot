"use client";

import { useEffect, useRef, useState } from "react";
import { Recorder } from "@/components/recorder";
import { Thread, type ThreadMsg } from "@/components/thread";
import { Button, Icon, Input, StatusPill, cx } from "@/components/ui";

const toBase64 = (b: Blob) =>
  new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.readAsDataURL(b);
  });

export function MockPhone({ users, initial }: { users: { name: string; phone: string; status: string }[]; initial: string }) {
  const [phone, setPhone] = useState(initial);
  const [messages, setMessages] = useState<ThreadMsg[]>([]);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (!phone) return;
      const r = await fetch(`/api/dev/phone?phone=${encodeURIComponent(phone)}`);
      if (live && r.ok) setMessages((await r.json()).messages);
    };
    load();
    const t = setInterval(load, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [phone]);

  const send = (body: object) => fetch("/api/dev/phone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: phone, ...body }) });

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        {users.map((u) => (
          <button key={u.phone} onClick={() => setPhone(u.phone)} className={cx("flex items-center justify-between rounded-[16px] px-4 py-3 text-left", phone === u.phone ? "bg-white shadow-card" : "hover:bg-blush-50")}>
            <span>
              <span className="block text-[14px] font-semibold text-ink">{u.name}</span>
              <span className="text-[12px] text-muted">{u.phone}</span>
            </span>
            <StatusPill status={u.status} />
          </button>
        ))}
        <Input placeholder="Or type any number, e.g. +60…" onKeyDown={(e) => e.key === "Enter" && setPhone((e.target as HTMLInputElement).value)} />
      </div>

      <div className="mx-auto flex h-[680px] w-full max-w-[420px] flex-col overflow-hidden rounded-[32px] border-[10px] border-ink bg-blush-50 shadow-card">
        <div className="flex items-center gap-3 bg-white px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-red">
            <Icon name="pulse" size={20} className="text-white" />
          </span>
          <span className="leading-tight">
            <span className="block text-[14px] font-semibold text-ink">Persona assistant</span>
            <span className="text-[11px] text-muted">as {phone}</span>
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <Thread messages={messages} perspective="phone" />
        </div>
        <form
          className="flex items-center gap-2 bg-white px-3 py-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            await send({ text });
            setText("");
          }}
        >
          <button type="button" aria-label="Attach photo" onClick={() => fileRef.current?.click()} className="text-muted hover:text-red-text">
            <Icon name="image" size={22} className="text-current" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await send({ media: { base64: await toBase64(f), mime: f.type }, caption: text || undefined });
              setText("");
              e.target.value = "";
            }}
          />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" className="h-10" />
          {text ? (
            <Button size="sm" aria-label="Send">
              <Icon name="paper-plane-right" size={18} className="text-white" />
            </Button>
          ) : (
            <Recorder label="" onDone={async (b) => send({ media: { base64: await toBase64(b), mime: b.type.split(";")[0] } })} />
          )}
        </form>
      </div>
    </div>
  );
}
