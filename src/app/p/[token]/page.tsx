import Link from "next/link";
import { postView, previewActor } from "@/server/services/posts";
import { PostWorkspace } from "@/components/post-workspace";
import { Card, EmptyState, Eyebrow, Logo, TwoToneTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your draft — Persona", robots: { index: false } };

/** Opened from the WhatsApp link. No login; the token is single-post and expires. */
export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await previewActor(token).catch(() => null);
  return (
    <div className="wash min-h-screen">
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-8">
        <Eyebrow>Your draft</Eyebrow>
        <Logo height={26} />
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
        {!resolved ? (
          <Card className="mx-auto mt-10 max-w-lg">
            <EmptyState icon="clock" title="This link has expired">
              Preview links work for 7 days, or until the post is approved. Ask for a fresh link on WhatsApp, or{" "}
              <Link href="/login" className="link">sign in</Link> to see your calendar.
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="mb-8">
              <TwoToneTitle lead="Does this" accent="sound like you?" />
            </div>
            <PostWorkspace view={JSON.parse(JSON.stringify(await postView(resolved.actor, resolved.post.id)))} apiBase={`/api/preview/${token}`} mode="preview" />
            <p className="mt-10 text-[13px] text-muted">
              To change your persona or cadence, <Link href="/login" className="link">sign in</Link>.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
