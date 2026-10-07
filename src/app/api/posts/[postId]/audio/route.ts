import { notFound } from "@/server/errors";
import { route } from "@/server/http";
import { isUuid } from "@/server/scope";
import { voiceChangeRequest } from "@/server/services/post-actions";
import { loadPost } from "@/server/services/posts";

export const POST = route<{ postId: string }>(async ({ req, actor, params }) => {
  if (!isUuid(params.postId)) throw notFound();
  await loadPost(actor, params.postId); // scope first
  await voiceChangeRequest(actor, params.postId, await req.formData(), "web");
  return { ok: true };
});
