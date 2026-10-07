"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Card, Field, IconCircle, Input, Notice, PageHeader } from "@/components/ui";

export function WhatsAppStep({ userId, phone, verified }: { userId: string; phone: string; verified: boolean }) {
  const router = useRouter();
  const [number, setNumber] = useState(phone);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState(verified);

  // Wait for the reply on WhatsApp. (Polls the API: once live, the onboarding pages redirect away.)
  useEffect(() => {
    if (!sent || live) return;
    const t = setInterval(async () => {
      const s = await api<{ user: { whatsappVerifiedAt: string | null } }>(`/api/users/${userId}/onboarding`).catch(() => null);
      if (s?.user.whatsappVerifiedAt) setLive(true);
    }, 2500);
    return () => clearInterval(t);
  }, [sent, live, userId]);

  if (live)
    return (
      <>
        <PageHeader eyebrow="Step 6 · WhatsApp" lead="You're live." accent="Over to WhatsApp." />
        <Card className="flex flex-col items-start gap-4">
          <IconCircle name="check-circle" solid />
          <p className="lead">Your number is verified and the welcome message is on its way. From now on, send topics, photos and voice notes on WhatsApp and approve drafts there.</p>
          <Button onClick={() => { router.push("/calendar"); router.refresh(); }}>See my calendar</Button>
        </Card>
      </>
    );

  return (
    <>
      <PageHeader
        eyebrow="Step 6 · WhatsApp"
        lead="Last step:"
        accent="connect WhatsApp."
        intro="Day to day, everything happens on WhatsApp. Confirm your number, then reply to the message we send."
      />
      <Card className="flex max-w-xl flex-col gap-5">
        {err && <Notice tone="alert">{err}</Notice>}
        <Field label="Your WhatsApp number" hint="International format, e.g. +60123456789">
          <Input value={number} onChange={(e) => setNumber(e.target.value.replace(/[\s-]/g, ""))} disabled={sent} inputMode="tel" />
        </Field>
        {!sent ? (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await api(`/api/users/${userId}/whatsapp/verify`, { body: { phone: number } });
                setSent(true);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Sending…" : "Send verification message"}
          </Button>
        ) : (
          <>
            <Notice>
              We've sent a message to <strong className="font-semibold">{number}</strong>. Reply to it as asked (it starts with YES and a 4-digit code). This page updates on its own.
            </Notice>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" size="sm" onClick={() => setSent(false)}>
                Change number or resend
              </Button>
              {process.env.NEXT_PUBLIC_DEV_TOOLS === "1" && (
                <Link href={`/dev/phone?phone=${encodeURIComponent(number)}`} target="_blank" className="link self-center text-[13px]">
                  Open the mock phone
                </Link>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
