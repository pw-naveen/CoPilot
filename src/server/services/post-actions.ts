import { z } from "zod";
import type { AnyActor } from "../actor";
import { badRequest } from "../errors";
import { newKey, storage } from "../storage";
import { skipSlot } from "./cadence";
import { approvePost, editPostText, loadPost, movePost, releaseFlagged, requestChanges, revertToVersion, setPostMedia } from "./posts";

export const postActionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), override: z.boolean().optional() }),
  z.object({ action: z.literal("changes"), feedback: z.string().max(4000) }),
  z.object({ action: z.literal("edit"), text: z.string().min(1).max(6000) }),
  z.object({ action: z.literal("media"), mediaIds: z.array(z.string().uuid()).max(4) }),
  z.object({ action: z.literal("move"), slotId: z.string().uuid() }),
  z.object({ action: z.literal("revert"), versionId: z.string().uuid() }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("skip") }),
]);

/** One entry point for every post action, shared by signed-in pages and preview links. */
export async function runPostAction(actor: AnyActor, postId: string, input: z.infer<typeof postActionInput>, via: "web" | "preview") {
  switch (input.action) {
    case "approve":
      return approvePost(actor, postId, via, { override: via === "web" && input.override });
    case "changes":
      return requestChanges(actor, postId, input.feedback, via);
    case "edit":
      return editPostText(actor, postId, input.text);
    case "media":
      return setPostMedia(actor, postId, input.mediaIds);
    case "move":
      return movePost(actor, postId, input.slotId);
    case "revert":
      return revertToVersion(actor, postId, input.versionId);
    case "release":
      if (via !== "web") throw badRequest("Not available here");
      return releaseFlagged(actor, postId);
    case "skip": {
      const post = await loadPost(actor, postId);
      if (!post.slotId) throw badRequest("This post has no slot");
      return skipSlot(actor, post.slotId);
    }
  }
}

/** Change request recorded as a voice note (optionally with typed text). */
export async function voiceChangeRequest(actor: AnyActor, postId: string, form: FormData, via: "web" | "preview") {
  const post = await loadPost(actor, postId);
  const audio = form.get("audio");
  if (!(audio instanceof File) || !audio.type.startsWith("audio/")) throw badRequest("Expected an audio recording");
  const key = newKey(post.userId, "audio", audio.type);
  await storage().put(key, Buffer.from(await audio.arrayBuffer()), audio.type);
  return requestChanges(actor, postId, String(form.get("feedback") ?? ""), via, key);
}
