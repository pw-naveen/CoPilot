import { body, publicRoute } from "@/server/http";
import { postActionInput, runPostAction } from "@/server/services/post-actions";
import { postView, previewActor } from "@/server/services/posts";

/** Tokenised, single-post access from the WhatsApp link. No login; acts as the post's user. */
type P = { token: string };

export const GET = publicRoute<P>(async ({ params }) => {
  const { post, actor } = await previewActor(params.token);
  return postView(actor, post.id);
});

export const POST = publicRoute<P>(async ({ req, params }) => {
  const { post, actor } = await previewActor(params.token);
  const input = await body(req, postActionInput);
  const result = await runPostAction(actor, post.id, input, "preview");
  return { ok: true, result: result ?? null };
});
