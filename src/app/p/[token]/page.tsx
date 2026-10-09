import Link from "next/link";
import { postView, previewActor } from "@/server/services/posts";
import { PostWorkspace } from "@/components/post-workspace";
import { Card, EmptyState, Logo } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your draft — CoPilot", robots: { index: false } };

/**
 * Opened from the WhatsApp link, usually on a phone, with no login: the token is
 * single-post and expires. It carries the same workspace as the signed-in post
 * page, so Approve and Request changes behave identically here.
 */
export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await previewActor(token).catch(() => null);
  const view = resolved ? JSON.parse(JSON.stringify(await postView(resolved.actor, resolved.post.id))) : null;
  return (
    <div className="min-h-[100dvh] bg-[var(--bg)]">
      <header className="sticky top-0 z-20 border-b border-line bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-7">
          <Logo height={26} />
          <span className="text-[12px] font-semibold tracking-[0.08em] text-muted uppercase">Draft approval</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 pt-6 pb-24 sm:px-7">
        {!view ? (
          <Card className="mx-auto mt-10 max-w-lg">
            <EmptyState icon="clock" title="This link has expired">
              Preview links work for 7 days, or until the post is approved. Ask for a fresh link on WhatsApp, or{" "}
              <Link href="/login" className="link">sign in</Link> to see your calendar.
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="mb-6 flex min-w-0 flex-col gap-1.5 border-b border-line pb-5">
              <h1 className="text-[23px] leading-tight font-semibold tracking-[-0.02em] text-ink">
                Does this <span className="text-red-text">sound like you?</span>
              </h1>
              <p className="text-[14px] text-muted">
                Approve it and it goes out as scheduled. Prefer a change? Say what to fix and I&apos;ll rewrite it.
              </p>
            </div>
            <PostWorkspace view={view} apiBase={`/api/preview/${token}`} mode="preview" />
            <p className="mt-10 text-[13px] text-muted">
              To change your persona or cadence, <Link href="/login" className="link">sign in</Link>.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
