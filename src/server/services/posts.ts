import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { actorRef, isAdmin, isStaff, SYSTEM, type AnyActor } from "../actor";
import * as ai from "../ai";
import { audit } from "../audit";
import { now as clockNow } from "../clock";
import { appBaseUrl } from "../config";
import { randomToken, sha256 } from "../crypto";
import { sendEmail } from "../email";
import { badRequest, conflict, notFound } from "../errors";
import type { Persona } from "../persona-schema";
import { publisher } from "../publisher";
import { assertUserAccess } from "../scope";
import { storage } from "../storage";
import { addJob } from "../queue";
import { requireActivePersona, savePersonaVersion } from "./persona";

/**
 * Drafts and approval. Statuses: awaiting_input → drafting → pending_approval →
 * approved, with changes_requested looping back through drafting; missed and
 * skipped are the other exits. Every change is audited with who made it.
 */

const PREVIEW_DAYS = 7;
const REFRESH_AFTER_EDITS = 5;
const MAX_GOLDEN = 12;
const inline = () => process.env.JOBS_INLINE === "1";

type Post = typeof schema.posts.$inferSelect;
type Slot = typeof schema.slots.$inferSelect;

export async function loadPost(actor: AnyActor, postId: string) {
  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) });
  if (!post) throw notFound();
  await assertUserAccess(actor, post.userId);
  return post;
}

export async function currentVersion(post: Post) {
  if (!post.currentVersionId) return null;
  return (await db.query.postVersions.findFirst({ where: eq(schema.postVersions.id, post.currentVersionId) })) ?? null;
}

/** The newest draft waiting for this user (what "approve" on WhatsApp refers to). */
export async function latestPendingPost(userId: string) {
  return db.query.posts.findFirst({
    where: and(eq(schema.posts.userId, userId), eq(schema.posts.status, "pending_approval"), eq(schema.posts.flaggedForStaff, false)),
    orderBy: desc(schema.posts.updatedAt),
  });
}

async function setStatus(post: Post, status: Post["status"], extra: Partial<Post> = {}) {
  await db.update(schema.posts).set({ status, ...extra }).where(eq(schema.posts.id, post.id));
  if (post.slotId) await db.update(schema.slots).set({ status, postId: post.id }).where(eq(schema.slots.id, post.slotId));
}

// ── input & generation ────────────────────────────────────────────────────

/** Text, transcripts, image descriptions and links from a bundle, as one input. */
export async function bundleInput(bundleId: string) {
  const msgs = await db.query.waMessages.findMany({ where: eq(schema.waMessages.bundleId, bundleId), orderBy: asc(schema.waMessages.createdAt) });
  const keys = msgs.map((m) => m.mediaUrl).filter(Boolean) as string[];
  const media = keys.length ? await db.query.media.findMany({ where: inArray(schema.media.storageKey, keys) }) : [];
  const parts: string[] = [];
  for (const m of msgs) {
    if (m.body) parts.push(m.body);
    if (m.transcript) parts.push(`(voice note) ${m.transcript}`);
    const im = media.find((x) => x.storageKey === m.mediaUrl);
    if (im) parts.push(`(photo) ${im.visionDescription ?? "an image"}`);
  }
  return { text: parts.join("\n"), images: media };
}

export async function recentPostTexts(userId: string, n = 15) {
  const rows = await db
    .select({ text: schema.postVersions.text })
    .from(schema.posts)
    .innerJoin(schema.postVersions, eq(schema.posts.currentVersionId, schema.postVersions.id))
    .where(and(eq(schema.posts.userId, userId), inArray(schema.posts.status, ["approved", "pending_approval"])))
    .orderBy(desc(schema.posts.createdAt))
    .limit(n);
  return rows.map((r) => r.text);
}

async function goldenFor(userId: string, persona: Persona) {
  const extra = await db.query.goldenCandidates.findMany({ where: eq(schema.goldenCandidates.userId, userId), orderBy: desc(schema.goldenCandidates.createdAt), limit: MAX_GOLDEN });
  const merged = [...persona.golden_examples];
  for (const g of extra) if (merged.length < MAX_GOLDEN && !merged.some((m) => m.post === g.post)) merged.push({ input: g.input, post: g.post });
  return { ...persona, golden_examples: merged };
}

/** Queue a draft for a slot. Marks it drafting right away so the scheduler doesn't double-queue. */
export async function queueDraft(slotId: string, opts: { suggestedTopic?: string } = {}) {
  const slot = await db.query.slots.findFirst({ where: eq(schema.slots.id, slotId) });
  if (!slot || !["awaiting_input"].includes(slot.status)) return;
  await db.update(schema.slots).set({ status: "drafting" }).where(eq(schema.slots.id, slotId));
  if (inline()) return generateDraftForSlot(slotId, opts);
  await addJob("drafts", "generate", { slotId, ...opts }, { jobId: `draft-${slotId}`, attempts: 3, backoff: { type: "exponential", delay: 10_000 } });
}

/**
 * Worker: write the draft, run the review pass (regenerate once on failure), and send
 * the preview link. A draft that fails review twice goes to staff, not the user.
 */
export async function generateDraftForSlot(slotId: string, opts: { suggestedTopic?: string } = {}) {
  const slot = (await db.query.slots.findFirst({ where: eq(schema.slots.id, slotId) }))!;
  const user = (await db.query.users.findFirst({ where: eq(schema.users.id, slot.userId) }))!;
  const { row: personaRow, persona } = await requireActivePersona(user.id);
  const bundle = await db.query.inputBundles.findFirst({ where: eq(schema.inputBundles.slotId, slotId), orderBy: desc(schema.inputBundles.createdAt) });
  const input = bundle ? await bundleInput(bundle.id) : { text: opts.suggestedTopic ?? "", images: [] as (typeof schema.media.$inferSelect)[] };
  const topic = (bundle?.extractedJson as { topic?: string } | null)?.topic || opts.suggestedTopic || input.text.slice(0, 120);
  const images: ai.DraftImage[] = input.images.map((m) => ({ id: m.id, description: m.visionDescription ?? "image", consent: m.consentFlag }));
  const p = await goldenFor(user.id, persona);
  const recent = await recentPostTexts(user.id);
  const slotDate = slot.publishAt.toISOString();

  let draft = await ai.generateDraft(user.id, { persona: p, input: input.text, recent, slotDate, images });
  let review = await ai.reviewDraft(user.id, { persona: p, input: input.text, text: draft.data.text, images });
  if (!review.data.pass) {
    draft = await ai.generateDraft(user.id, { persona: p, input: input.text, recent, slotDate, images, issues: review.data.issues });
    review = await ai.reviewDraft(user.id, { persona: p, input: input.text, text: draft.data.text, images });
  }
  const flagged = !review.data.pass;
  const mediaIds = draft.data.image_ids.filter((id) => images.some((i) => i.id === id)).slice(0, 4);

  const post = await db.transaction(async (tx) => {
    let post = slot.postId ? await tx.query.posts.findFirst({ where: eq(schema.posts.id, slot.postId) }) : undefined;
    if (!post)
      [post] = await tx
        .insert(schema.posts)
        .values({ userId: user.id, slotId, bundleId: bundle?.id ?? null, status: "drafting", suggestedTopic: !bundle, topic })
        .returning();
    const [v] = await tx
      .insert(schema.postVersions)
      .values({ postId: post.id, number: 1, text: draft.data.text, media: mediaIds, personaVersion: personaRow.version, promptVersion: draft.promptVersion, model: draft.model, createdBy: "ai" })
      .returning();
    await tx
      .update(schema.posts)
      .set({ currentVersionId: v.id, status: "pending_approval", summary: draft.data.summary, firstComment: draft.data.first_comment || null, flaggedForStaff: flagged, reviewIssues: flagged ? review.data.issues : null })
      .where(eq(schema.posts.id, post.id));
    await tx.update(schema.slots).set({ status: "pending_approval", postId: post.id }).where(eq(schema.slots.id, slotId));
    return post;
  });
  await audit(SYSTEM, { action: flagged ? "post.flagged" : "post.drafted", entity: "post", entityId: post.id, userId: user.id, after: { slotId, suggested: !bundle, issues: flagged ? review.data.issues : undefined } });

  if (flagged) await alertStaff(user.id, `Draft needs review: ${user.displayName}`, `A draft for ${fmt(slot.publishAt, user.timezone)} failed the compliance/persona review twice and was not sent to ${user.displayName}.\n\nIssues:\n- ${review.data.issues.join("\n- ")}\n\nOpen it: ${appBaseUrl()}/admin/posts/${post.id}`);
  else await sendPreview(post.id, "draft");
  return { postId: post.id, flagged };
}

/** Issue a fresh preview token and send the link on WhatsApp (with email fallback). */
export async function sendPreview(postId: string, kind: "draft" | "revision") {
  const post = (await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) }))!;
  const user = (await db.query.users.findFirst({ where: eq(schema.users.id, post.userId) }))!;
  const slot = post.slotId ? await db.query.slots.findFirst({ where: eq(schema.slots.id, post.slotId) }) : null;
  const link = await createPreviewLink(post.id);
  const when = slot ? fmt(slot.publishAt, user.timezone) : "your next slot";
  const by = slot ? fmt(slot.approvalDeadline, user.timezone) : "";
  const lead = kind === "draft" ? `Here's your draft for ${when}${post.suggestedTopic ? " (I picked a topic from your pillars)" : ""}:` : `Updated draft for ${when}:`;
  const text = `${lead} ${post.summary ?? ""}\n\n${link}\n\nReply "approve" to approve it, or tell me what to change.${by ? ` I need your approval by ${by}.` : ""}`;
  const { queueMessage } = await import("../whatsapp/outbox");
  await queueMessage({ userId: user.id, phone: user.phoneE164, kind: "draft", text, emailFallback: { to: user.email, subject: `Draft for ${when}`, text } });
}

export async function createPreviewLink(postId: string) {
  const token = randomToken(24);
  await db.insert(schema.previewTokens).values({ postId, tokenHash: sha256(token), expiresAt: new Date((await clockNow()).getTime() + PREVIEW_DAYS * 86_400_000) });
  return `${appBaseUrl()}/p/${token}`;
}

/** Resolve a preview token: single post, expires after 7 days or once approved. */
export async function resolvePreview(token: string) {
  const row = await db.query.previewTokens.findFirst({ where: and(eq(schema.previewTokens.tokenHash, sha256(token)), gt(schema.previewTokens.expiresAt, await clockNow())) });
  if (!row) return null;
  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, row.postId) });
  if (!post || post.status === "approved") return null;
  return post;
}

// ── user and staff actions ────────────────────────────────────────────────

/** "via" says where the action came from, for the audit log and confirmations. */
type Via = "web" | "preview" | "whatsapp";

export async function approvePost(actor: AnyActor, postId: string, via: Via, opts: { override?: boolean } = {}) {
  const post = await loadPost(actor, postId);
  if (post.status !== "pending_approval") throw conflict(post.status === "approved" ? "Already approved" : "This draft isn't waiting for approval");
  if (post.flaggedForStaff && !isStaff(actor)) throw conflict("This draft is being checked by the team first");
  const slot = post.slotId ? await db.query.slots.findFirst({ where: eq(schema.slots.id, post.slotId) }) : null;
  const user = (await db.query.users.findFirst({ where: eq(schema.users.id, post.userId) }))!;
  const now = await clockNow();
  if (slot && slot.approvalDeadline <= now) {
    if (!(opts.override && isAdmin(actor))) throw conflict("The approval deadline has passed. Move it to a later slot instead.");
    await audit(actor, { action: "post.approve_override", entity: "post", entityId: post.id, userId: post.userId });
  }

  // Staff approval may still need the user's own approval (per-account setting).
  if (isStaff(actor) && !user.staffApprovalIsFinal) {
    await db.update(schema.posts).set({ staffApprovedBy: actor.id, staffApprovedAt: now }).where(eq(schema.posts.id, post.id));
    await audit(actor, { action: "post.staff_approve", entity: "post", entityId: post.id, userId: post.userId, after: { final: false } });
    return { final: false };
  }

  const v = await currentVersion(post);
  await setStatus(post, "approved", { approvedAt: now, approvedBy: actorRef(actor), publishAt: slot?.publishAt ?? null });
  await db.delete(schema.previewTokens).where(eq(schema.previewTokens.postId, post.id));
  await audit(actor, { action: "post.approve", entity: "post", entityId: post.id, userId: post.userId, after: { via, versionId: v?.id } });

  // Approved without edits → candidate golden example.
  if (v && v.createdBy === "ai") {
    const input = post.bundleId ? (await bundleInput(post.bundleId)).text : post.topic ?? "";
    await db.insert(schema.goldenCandidates).values({ userId: post.userId, postId: post.id, input: input.slice(0, 2000), post: v.text });
  }
  if (slot && v) await publisher().schedule({ id: post.id, userId: post.userId, text: v.text, media: v.media, publishAt: slot.publishAt });

  const { queueMessage } = await import("../whatsapp/outbox");
  const who = isStaff(actor) ? ` ${actor.name} approved it for you.` : "";
  await queueMessage({ userId: user.id, phone: user.phoneE164, kind: "reply", text: `Approved. It's scheduled for ${slot ? fmt(slot.publishAt, user.timezone) : "your next slot"}.${who}` });
  return { final: true };
}

export async function requestChanges(actor: AnyActor, postId: string, feedback: string, via: Via, audioKey?: string) {
  const post = await loadPost(actor, postId);
  if (!["pending_approval"].includes(post.status)) throw conflict("This draft isn't waiting for approval");
  if (!feedback.trim() && !audioKey) throw badRequest("Tell us what to change");
  await setStatus(post, "changes_requested");
  await audit(actor, { action: "post.request_changes", entity: "post", entityId: post.id, userId: post.userId, after: { feedback, via } });
  const data = { postId, feedback, by: actorRef(actor), audioKey };
  if (inline()) return reviseDraft(data);
  await addJob("drafts", "revise", data, { attempts: 3, backoff: { type: "exponential", delay: 10_000 } });
}

/** Worker: revise from feedback (voice notes transcribed first), review, send a new link. */
export async function reviseDraft({ postId, feedback, by, audioKey }: { postId: string; feedback: string; by: string; audioKey?: string }) {
  const post = (await db.query.posts.findFirst({ where: eq(schema.posts.id, postId) }))!;
  if (audioKey) {
    const audio = await storage().get(audioKey);
    feedback = [feedback, await ai.transcribe(post.userId, audio, "audio/webm")].filter(Boolean).join("\n");
  }
  await setStatus(post, "drafting");
  const { row: personaRow, persona } = await requireActivePersona(post.userId);
  const v = (await currentVersion(post))!;
  let rev = await ai.reviseDraft(post.userId, { persona, text: v.text, feedback });
  const imgs = v.media.length ? await db.query.media.findMany({ where: inArray(schema.media.id, v.media) }) : [];
  const images = imgs.map((m) => ({ id: m.id, description: m.visionDescription ?? "image", consent: m.consentFlag }));
  const input = post.bundleId ? (await bundleInput(post.bundleId)).text : post.topic ?? "";
  let review = await ai.reviewDraft(post.userId, { persona, input, text: rev.data.text, images });
  if (!review.data.pass) {
    rev = await ai.reviseDraft(post.userId, { persona, text: v.text, feedback: `${feedback}\n\nAlso fix: ${review.data.issues.join("; ")}` });
    review = await ai.reviewDraft(post.userId, { persona, input, text: rev.data.text, images });
  }
  const flagged = !review.data.pass;
  const [nv] = await db
    .insert(schema.postVersions)
    .values({ postId, number: v.number + 1, text: rev.data.text, media: v.media, personaVersion: personaRow.version, promptVersion: rev.promptVersion, model: rev.model, createdBy: "ai", feedback })
    .returning();
  await setStatus(post, "pending_approval", { currentVersionId: nv.id, summary: rev.data.summary || post.summary, flaggedForStaff: flagged, reviewIssues: flagged ? review.data.issues : null });
  await recordEdit(post.userId, postId, "change_request", v.text, rev.data.text, feedback);
  await audit({ type: "system", id: "drafts" }, { action: flagged ? "post.flagged" : "post.revised", entity: "post", entityId: postId, userId: post.userId, after: { version: nv.number, by } });
  if (flagged) {
    const u = (await db.query.users.findFirst({ where: eq(schema.users.id, post.userId) }))!;
    await alertStaff(post.userId, `Revision needs review: ${u.displayName}`, `A revised draft failed review twice.\n\n- ${review.data.issues.join("\n- ")}\n\n${appBaseUrl()}/admin/posts/${postId}`);
  } else await sendPreview(postId, "revision");
}

export async function editPostText(actor: AnyActor, postId: string, text: string) {
  const post = await loadPost(actor, postId);
  if (!["pending_approval", "changes_requested"].includes(post.status)) throw conflict("Only drafts waiting for approval can be edited");
  const v = (await currentVersion(post))!;
  if (text.trim() === v.text.trim()) return v;
  const [nv] = await db
    .insert(schema.postVersions)
    .values({ postId, number: v.number + 1, text: text.trim(), media: v.media, personaVersion: v.personaVersion, createdBy: actorRef(actor) })
    .returning();
  await setStatus(post, "pending_approval", { currentVersionId: nv.id, flaggedForStaff: isStaff(actor) ? false : post.flaggedForStaff });
  await recordEdit(post.userId, postId, "inline_edit", v.text, nv.text, null);
  await audit(actor, { action: "post.edit", entity: "post", entityId: postId, userId: post.userId, before: { version: v.number }, after: { version: nv.number } });
  return nv;
}

export async function setPostMedia(actor: AnyActor, postId: string, mediaIds: string[]) {
  const post = await loadPost(actor, postId);
  if (post.status !== "pending_approval") throw conflict("Only drafts waiting for approval can be changed");
  if (mediaIds.length > 4) throw badRequest("Up to 4 images");
  if (mediaIds.length) {
    const owned = await db.query.media.findMany({ where: and(inArray(schema.media.id, mediaIds), eq(schema.media.userId, post.userId)) });
    if (owned.length !== new Set(mediaIds).size) throw notFound("Unknown image");
  }
  const v = (await currentVersion(post))!;
  const [nv] = await db
    .insert(schema.postVersions)
    .values({ postId, number: v.number + 1, text: v.text, media: mediaIds, personaVersion: v.personaVersion, createdBy: actorRef(actor), feedback: "Images changed" })
    .returning();
  await db.update(schema.posts).set({ currentVersionId: nv.id }).where(eq(schema.posts.id, postId));
  await audit(actor, { action: "post.media", entity: "post", entityId: postId, userId: post.userId, before: v.media, after: mediaIds });
  return nv;
}

export async function revertToVersion(actor: AnyActor, postId: string, versionId: string) {
  const post = await loadPost(actor, postId);
  if (post.status !== "pending_approval") throw conflict("Only drafts waiting for approval can be changed");
  const old = await db.query.postVersions.findFirst({ where: and(eq(schema.postVersions.id, versionId), eq(schema.postVersions.postId, postId)) });
  if (!old) throw notFound();
  const v = (await currentVersion(post))!;
  const [nv] = await db
    .insert(schema.postVersions)
    .values({ postId, number: v.number + 1, text: old.text, media: old.media, personaVersion: old.personaVersion, createdBy: actorRef(actor), feedback: `Restored version ${old.number}` })
    .returning();
  await db.update(schema.posts).set({ currentVersionId: nv.id }).where(eq(schema.posts.id, postId));
  await audit(actor, { action: "post.revert", entity: "post", entityId: postId, userId: post.userId, after: { from: old.number, to: nv.number } });
  return nv;
}

/** Move a draft to another free slot (also the way to rescue a missed post). */
export async function movePost(actor: AnyActor, postId: string, slotId: string) {
  const post = await loadPost(actor, postId);
  if (["approved", "skipped"].includes(post.status)) throw conflict("This post can't be moved");
  const target = await db.query.slots.findFirst({ where: and(eq(schema.slots.id, slotId), eq(schema.slots.userId, post.userId)) });
  if (!target) throw notFound();
  const now = await clockNow();
  if (target.status !== "awaiting_input" || target.postId) throw conflict("That slot already has a post");
  if (target.approvalDeadline <= now) throw conflict("That slot's approval deadline has passed");
  const from = post.slotId;
  await db.transaction(async (tx) => {
    if (from) {
      const old = await tx.query.slots.findFirst({ where: eq(schema.slots.id, from) });
      // A slot whose deadline has passed stays missed; otherwise it's free again.
      const reopen = old && old.approvalDeadline > now;
      await tx.update(schema.slots).set({ postId: null, status: reopen ? "awaiting_input" : "missed", autoDraftAt: null }).where(eq(schema.slots.id, from));
    }
    const status = post.status === "missed" ? "pending_approval" : post.status;
    await tx.update(schema.posts).set({ slotId, status }).where(eq(schema.posts.id, postId));
    await tx.update(schema.slots).set({ postId, status }).where(eq(schema.slots.id, slotId));
    if (post.bundleId) await tx.update(schema.inputBundles).set({ slotId }).where(eq(schema.inputBundles.id, post.bundleId));
  });
  await audit(actor, { action: "post.move", entity: "post", entityId: postId, userId: post.userId, before: { slotId: from }, after: { slotId } });
}

/** Staff release a flagged draft to the user after fixing it. */
export async function releaseFlagged(actor: AnyActor, postId: string) {
  const post = await loadPost(actor, postId);
  if (!isStaff(actor)) throw notFound();
  if (!post.flaggedForStaff) throw conflict("This draft isn't flagged");
  await db.update(schema.posts).set({ flaggedForStaff: false, reviewIssues: null }).where(eq(schema.posts.id, postId));
  await audit(actor, { action: "post.release", entity: "post", entityId: postId, userId: post.userId });
  await sendPreview(postId, "draft");
}

// ── learning from edits ───────────────────────────────────────────────────

async function recordEdit(userId: string, postId: string, kind: "inline_edit" | "change_request", before: string, after: string | null, feedback: string | null) {
  await db.insert(schema.editPairs).values({ userId, postId, kind, before, after, feedback });
  const pending = await db.query.editPairs.findMany({ where: and(eq(schema.editPairs.userId, userId), isNull(schema.editPairs.consumedInVersion)) });
  if (pending.length >= REFRESH_AFTER_EDITS) {
    if (inline()) await refreshPersonaFromEdits(userId);
    else await addJob("drafts", "persona-refresh", { userId }, { jobId: `refresh-${userId}-${pending.length}` });
  }
}

/** After 5 edits: propose persona changes as a new version, tell the user in one line. */
export async function refreshPersonaFromEdits(userId: string) {
  const pending = await db.query.editPairs.findMany({ where: and(eq(schema.editPairs.userId, userId), isNull(schema.editPairs.consumedInVersion)), orderBy: asc(schema.editPairs.createdAt) });
  if (pending.length < REFRESH_AFTER_EDITS) return null;
  const { persona } = await requireActivePersona(userId);
  const { data } = await ai.refreshPersona(userId, persona, pending.map((e) => ({ before: e.before, after: e.after, feedback: e.feedback })));
  data.persona.golden_examples = persona.golden_examples;
  const row = await savePersonaVersion(userId, data.persona, "system:refresh", `Refreshed from ${pending.length} edits${data.user_message ? `: ${data.user_message}` : ""}`);
  await db.update(schema.editPairs).set({ consumedInVersion: row.version }).where(inArray(schema.editPairs.id, pending.map((p) => p.id)));
  await audit(SYSTEM, { action: "persona.refresh", entity: "persona", entityId: row.id, userId, after: { version: row.version, message: data.user_message } });
  if (data.user_message) {
    const u = (await db.query.users.findFirst({ where: eq(schema.users.id, userId) }))!;
    const { queueMessage } = await import("../whatsapp/outbox");
    await queueMessage({ userId, phone: u.phoneE164, kind: "system", text: data.user_message });
  }
  return row;
}

// ── helpers ───────────────────────────────────────────────────────────────

export async function alertStaff(userId: string, subject: string, text: string) {
  const subs = await db
    .select({ email: schema.staff.email })
    .from(schema.subadminAccounts)
    .innerJoin(schema.staff, eq(schema.staff.id, schema.subadminAccounts.staffId))
    .where(eq(schema.subadminAccounts.userId, userId));
  const to = subs.length ? subs : await db.select({ email: schema.staff.email }).from(schema.staff).where(eq(schema.staff.role, "admin"));
  for (const s of to) await sendEmail(s.email, subject, text);
}

export const fmt = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz })
    .format(d)
    .replace(/\s?(am|pm)$/i, (m) => m.trim().toLowerCase());

export async function listPostVersions(actor: AnyActor, postId: string) {
  await loadPost(actor, postId);
  return db.query.postVersions.findMany({ where: eq(schema.postVersions.postId, postId), orderBy: desc(schema.postVersions.number) });
}

export async function freeSlots(userId: string) {
  const now = await clockNow();
  return db.query.slots.findMany({
    where: and(eq(schema.slots.userId, userId), eq(schema.slots.status, "awaiting_input"), isNull(schema.slots.postId), gt(schema.slots.approvalDeadline, now)),
    orderBy: asc(schema.slots.publishAt),
  });
}

export type { Slot };
