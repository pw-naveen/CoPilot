import { publicRoute } from "@/server/http";
import { voiceChangeRequest } from "@/server/services/post-actions";
import { previewActor } from "@/server/services/posts";

export const POST = publicRoute<{ token: string }>(async ({ req, params }) => {
  const { post, actor } = await previewActor(params.token);
  await voiceChangeRequest(actor, post.id, await req.formData(), "preview");
  return { ok: true };
});
