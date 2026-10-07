import { notFound } from "@/server/errors";
import { body, route } from "@/server/http";
import { isUuid } from "@/server/scope";
import { postActionInput, runPostAction } from "@/server/services/post-actions";
import { postView } from "@/server/services/posts";

type P = { postId: string };

export const GET = route<P>(async ({ actor, params }) => {
  if (!isUuid(params.postId)) throw notFound();
  return postView(actor, params.postId);
});

export const POST = route<P>(async ({ req, actor, params }) => {
  if (!isUuid(params.postId)) throw notFound();
  const result = await runPostAction(actor, params.postId, await body(req, postActionInput), "web");
  return { ok: true, result: result ?? null };
});
