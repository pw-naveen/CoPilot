import Link from "next/link";
import { notFound } from "next/navigation";
import { staffActor } from "@/server/page-auth";
import { isUuid } from "@/server/scope";
import { postView } from "@/server/services/posts";
import { PostWorkspace } from "@/components/post-workspace";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StaffPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const actor = await staffActor();
  const { postId } = await params;
  if (!isUuid(postId)) notFound();
  const view = await postView(actor, postId).catch(() => null);
  if (!view) notFound();
  return (
    <>
      <PageHeader
        eyebrow={`Post · ${view.user.displayName}`}
        lead="Review it," accent="or act for them."
        intro={
          <>
            Changes you make are recorded as yours and shown to {view.user.displayName}.{" "}
            {view.user.staffApprovalIsFinal ? "Staff approval is final for this account." : "Your approval doesn't replace theirs on this account."}{" "}
            <Link href={`/admin/users/${view.user.id}`} className="link">Account</Link>
          </>
        }
      />
      <PostWorkspace view={JSON.parse(JSON.stringify(view))} apiBase={`/api/posts/${postId}`} mode="staff" isAdmin={actor.role === "admin"} />
    </>
  );
}
