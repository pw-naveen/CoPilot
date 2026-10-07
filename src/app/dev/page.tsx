import Link from "next/link";
import { Card, IconCircle, PageHeader } from "@/components/ui";
import type { IconName } from "@/components/icon-paths";

const tools: { href: string; icon: IconName; title: string; text: string }[] = [
  { href: "/dev/mail", icon: "envelope-simple", title: "Mailbox", text: "Sign-in links, invites and fallback emails. Nothing is sent while SMTP is empty." },
  { href: "/dev/phone", icon: "device-mobile", title: "Mock phone", text: "Chat as any user over the MockGateway: text, voice notes, photos." },
  { href: "/dev/clock", icon: "clock", title: "Time travel", text: "Move the scheduler clock forward and run its jobs immediately." },
];

export default function DevHome() {
  return (
    <>
      <PageHeader eyebrow="Development" lead="Test it all" accent="without waiting." intro="These tools exist only when DEV_TOOLS=1 outside production." />
      <div className="grid gap-6 md:grid-cols-3">
        {tools.map((t) => (
          <Link key={t.href} href={t.href}>
            <Card className="flex h-full flex-col gap-3 transition-transform hover:-translate-y-0.5">
              <IconCircle name={t.icon} />
              <p className="card-title">{t.title}</p>
              <p className="text-[14px] text-muted">{t.text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
