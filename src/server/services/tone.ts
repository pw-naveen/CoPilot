import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { actorRef, type AnyActor } from "../actor";
import * as ai from "../ai";
import { audit } from "../audit";
import { conflict, notFound } from "../errors";
import { enqueue } from "../jobs";
import { SAMPLE_KINDS } from "../persona-schema";
import { assertUserAccess } from "../scope";
import { addGoldenExamples, applyPersonaFeedback, requireActivePersona } from "./persona";

/** Worker: create the three tone-check samples (or regenerate the given kinds). */
export async function generateToneSamples(userId: string, kinds?: string[]) {
  const { persona, row } = await requireActivePersona(userId);
  const prompts = SAMPLE_KINDS.filter((k) => !kinds || kinds.includes(k.kind));
  const { data } = await ai.toneSamples(userId, persona, prompts.map((p) => ({ kind: p.kind, prompt: p.prompt })));
  for (const p of prompts) {
    const text = data.samples.find((s) => s.kind === p.kind)?.text ?? data.samples[prompts.indexOf(p)]?.text;
    if (!text) continue;
    const existing = await db.query.toneSamples.findFirst({ where: and(eq(schema.toneSamples.userId, userId), eq(schema.toneSamples.kind, p.kind)) });
    if (existing) {
      await db
        .update(schema.toneSamples)
        .set({ text, personaVersion: row.version, verdict: null, comment: null, rounds: existing.rounds + 1 })
        .where(eq(schema.toneSamples.id, existing.id));
    } else {
      await db.insert(schema.toneSamples).values({ userId, kind: p.kind, prompt: p.prompt, text, personaVersion: row.version });
    }
  }
  return { personaVersion: row.version };
}

export const toneFeedbackInput = z.object({
  verdict: z.enum(["sounds_like_me", "close", "not_me"]),
  comment: z.string().trim().max(2000).default(""),
});

/**
 * “Sounds like me” marks the sample; otherwise the comment updates the persona and the
 * sample is rewritten (async). When all three sound right the step completes and the
 * samples become the persona's first golden examples.
 */
export async function toneFeedback(actor: AnyActor, userId: string, sampleId: string, input: z.infer<typeof toneFeedbackInput>) {
  await assertUserAccess(actor, userId);
  const sample = await db.query.toneSamples.findFirst({ where: and(eq(schema.toneSamples.id, sampleId), eq(schema.toneSamples.userId, userId)) });
  if (!sample) throw notFound();
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (u?.onboardingStep !== 5 && u?.status !== "active") throw conflict("The tone check isn't open");
  await audit(actor, { action: "tone.feedback", entity: "tone_sample", entityId: sampleId, userId, after: input });

  if (input.verdict === "sounds_like_me") {
    await db.update(schema.toneSamples).set({ verdict: "sounds_like_me", comment: null }).where(eq(schema.toneSamples.id, sampleId));
    const all = await db.query.toneSamples.findMany({ where: eq(schema.toneSamples.userId, userId) });
    const done = all.length >= SAMPLE_KINDS.length && all.every((s) => s.verdict === "sounds_like_me");
    if (done && u?.onboardingStep === 5) {
      await addGoldenExamples(
        userId,
        all.map((s) => ({ input: s.prompt, post: s.text })),
        actorRef(actor),
        "Tone check approved: samples added as golden examples",
      );
      await db.update(schema.users).set({ onboardingStep: 6 }).where(eq(schema.users.id, userId));
      await audit(actor, { action: "onboarding.step", entity: "user", entityId: userId, userId, after: { completed: "tone", next: "cadence" } });
    }
    return { done };
  }
  if (!input.comment) throw conflict("Tell us what to change");
  await db.update(schema.toneSamples).set({ verdict: input.verdict, comment: input.comment }).where(eq(schema.toneSamples.id, sampleId));
  const jobId = await enqueue("tone_feedback", userId, { sampleId, by: actorRef(actor) });
  return { done: false, jobId };
}

/** Worker: apply the sample's comment to the persona, then rewrite that sample. */
export async function processToneFeedback(userId: string, sampleId: string, by: string) {
  const sample = await db.query.toneSamples.findFirst({ where: eq(schema.toneSamples.id, sampleId) });
  if (!sample) throw notFound();
  const res = await applyPersonaFeedback(userId, sample.text, sample.verdict ?? "close", sample.comment ?? "", by);
  await generateToneSamples(userId, [sample.kind]);
  return { personaVersion: res.version, message: res.message };
}
