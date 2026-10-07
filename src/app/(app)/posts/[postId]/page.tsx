import { notFound } from "next/navigation";
import { userActor } from "@/server/page-auth";
import { isUuid } from "@/server/scope";
import { postView } from "@/server/services/posts";
import { PostWorkspace } from "@/components/post-workspace";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PostPage({ params }: { params: Promise<{ postId: string }> }) {
  const actor = await userActor();
  const { postId } = await params;
  if (!isUuid(postId)) notFound();
  const view = await postView(actor, postId).catch(() => null);
  if (!view) notFound();
  return (
    <>
      <PageHeader eyebrow="Draft" lead="Your post," accent="your call." />
      <PostWorkspace view={JSON.parse(JSON.stringify(view))} apiBase={`/api/posts/${postId}`} mode="user" />
    </>
  );
}
