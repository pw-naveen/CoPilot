import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { actorRef, type AnyActor } from "../actor";
import { audit } from "../audit";
import { badRequest, conflict, notFound } from "../errors";
import { enqueue } from "../jobs";
import { PREF_KEYS, QUESTIONS, SAMPLE_KINDS } from "../persona-schema";
import { assertUserAccess } from "../scope";
import { devToolsEnabled } from "../clock";
import { newKey, storage } from "../storage";
import { activePersona } from "./persona";

/**
 * Seven setup steps in a fixed order; progress is saved after every step.
 *   1 invite/login · 2 profile · 3 voice questionnaire · 4 persona review
 *   5 tone check · 6 cadence
 *
 * WhatsApp is verified at sign-up, before an admin approves the account, so
 * cadence is the last step and completing it makes the account live.
 */
export const STEPS = ["", "invite", "profile", "voice", "persona", "tone", "cadence"] as const;
export const MIN_ANSWERS = 6;
export const MAX_SAMPLES = 10;

async function user(actor: AnyActor, userId: string) {
  await assertUserAccess(actor, userId);
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) throw notFound();
  return u;
}

export async function onboardingState(actor: AnyActor, userId: string) {
  const u = await user(actor, userId);
  const [answers, samples, persona, tone, cadence] = await Promise.all([
    db.query.onboardingAnswers.findMany({ where: eq(schema.onboardingAnswers.userId, userId) }),
    db.query.writingSamples.findMany({ where: eq(schema.writingSamples.userId, userId), orderBy: asc(schema.writingSamples.createdAt) }),
    activePersona(userId),
    db.query.toneSamples.findMany({ where: eq(schema.toneSamples.userId, userId), orderBy: asc(schema.toneSamples.createdAt) }),
    db.query.cadences.findFirst({ where: eq(schema.cadences.userId, userId), orderBy: (c, { desc }) => desc(c.effectiveFrom) }),
  ]);
  return {
    user: u,
    answers: await Promise.all(
      answers.map(async (a) => ({ ...a, audioSignedUrl: a.audioUrl ? await storage().signedUrl(a.audioUrl) : null })),
    ),
    samples,
    persona,
    tone,
    cadence,
  };
}

export const profileInput = z.object({
  name: z.string().trim().min(1),
  displayName: z.string().trim().min(1).max(60),
  title: z.string().trim().max(120).optional().default(""),
  org: z.string().trim().max(120).optional().default(""),
  specialty: z.string().trim().max(120).optional().default(""),
  linkedinUrl: z
    .string()
    .trim()
    .max(300)
    .refine((s) => s === "" || /^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(s), "Use your LinkedIn profile URL")
    .optional()
    .default(""),
  languages: z.array(z.enum(["en", "ms", "mixed"])).min(1),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown time zone"),
});

export async function saveProfile(actor: AnyActor, userId: string, input: z.infer<typeof profileInput>) {
  const before = await user(actor, userId);
  const [after] = await db
    .update(schema.users)
    .set({
      name: input.name,
      displayName: input.displayName,
      title: input.title || null,
      org: input.org || null,
      specialty: input.specialty || null,
      linkedinUrl: input.linkedinUrl || null,
      languages: input.languages,
      timezone: input.timezone,
    })
    .where(eq(schema.users.id, userId))
    .returning();
  await audit(actor, { action: "profile.update", entity: "user", entityId: userId, userId, before: { displayName: before.displayName, timezone: before.timezone }, after: input });
  return after;
}

const ANSWER_KEYS = new Set<string>([...QUESTIONS.map((q) => q.key), ...PREF_KEYS]);

export async function saveAnswer(actor: AnyActor, userId: string, key: string, text: string) {
  await user(actor, userId);
  if (!ANSWER_KEYS.has(key)) throw badRequest("Unknown question");
  await db
    .insert(schema.onboardingAnswers)
    .values({ userId, questionKey: key, text })
    .onConflictDoUpdate({ target: [schema.onboardingAnswers.userId, schema.onboardingAnswers.questionKey], set: { text } });
}

/** Stores a recorded answer and queues transcription. Returns the job id to poll. */
export async function saveAudioAnswer(actor: AnyActor, userId: string, key: string, file: File) {
  await user(actor, userId);
  if (!QUESTIONS.some((q) => q.key === key)) throw badRequest("Unknown question");
  if (!file.type.startsWith("audio/")) throw badRequest("Expected an audio recording");
  if (file.size > 15 * 1024 * 1024) throw badRequest("Recording is too long");
  const storageKey = newKey(userId, "audio", file.type);
  await storage().put(storageKey, Buffer.from(await file.arrayBuffer()), file.type);
  await db
    .insert(schema.onboardingAnswers)
    .values({ userId, questionKey: key, audioUrl: storageKey, transcript: null })
    .onConflictDoUpdate({ target: [schema.onboardingAnswers.userId, schema.onboardingAnswers.questionKey], set: { audioUrl: storageKey, transcript: null } });
  return enqueue("transcribe_answer", userId, { key, storageKey, mime: file.type });
}

/**
 * Discards a recorded answer, so the user can type instead or record again.
 * Without this a transcription that exhausts its retries would strand the user:
 * step 3 refuses to complete while any answer has audio but no transcript, and
 * saving text does not clear the audio.
 */
export async function clearAudioAnswer(actor: AnyActor, userId: string, key: string) {
  await user(actor, userId);
  if (!QUESTIONS.some((q) => q.key === key)) throw badRequest("Unknown question");
  await db
    .update(schema.onboardingAnswers)
    .set({ audioUrl: null, transcript: null })
    .where(and(eq(schema.onboardingAnswers.userId, userId), eq(schema.onboardingAnswers.questionKey, key)));
}

/** How long a job may sit unclaimed before we stop calling it "in progress". */
const WORKER_STALL_MS = 45_000;

/**
 * Drives the questionnaire's progress and, more importantly, says *why* a voice
 * note is not transcribed yet. Without this a failed job is indistinguishable
 * from a slow one and the UI claims "transcribing" forever.
 *
 * `detail` is the real error and is only populated when DEV_TOOLS is on.
 */
export async function answerStates(actor: AnyActor, userId: string) {
  await user(actor, userId);
  const [rows, jobs] = await Promise.all([
    db.query.onboardingAnswers.findMany({ where: eq(schema.onboardingAnswers.userId, userId) }),
    db.query.jobs.findMany({
      where: and(eq(schema.jobs.userId, userId), eq(schema.jobs.kind, "transcribe_answer")),
      orderBy: (j, { desc }) => desc(j.createdAt),
      limit: 60,
    }),
  ]);

  // Newest job per question key.
  const latest = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) {
    const key = (j.input as { key?: string } | null)?.key;
    if (key && !latest.has(key)) latest.set(key, j);
  }
  const dev = devToolsEnabled();
  const now = Date.now();

  return {
    answers: rows.map((a) => {
      const job = latest.get(a.questionKey);
      let status: "none" | "pending" | "stalled" | "failed" | "done" = "none";
      if (a.transcript) status = "done";
      else if (a.audioUrl) {
        if (!job) status = "pending";
        else if (job.status === "failed") status = "failed";
        else if (job.status === "queued" && now - job.createdAt.getTime() > WORKER_STALL_MS) status = "stalled";
        else status = "pending";
      }
      return {
        key: a.questionKey,
        text: a.text ?? "",
        hasAudio: !!a.audioUrl,
        transcript: a.transcript,
        status,
        attempts: job?.attempts ?? 0,
        error: status === "failed" ? (job?.error ?? "Transcription failed.") : null,
        detail: dev && status !== "done" ? (job?.errorDetail ?? null) : null,
      };
    }),
    // A job stuck in `queued` almost always means nothing is draining the queue.
    workerStalled: rows.some((a) => {
      const j = latest.get(a.questionKey);
      return !a.transcript && !!a.audioUrl && j?.status === "queued" && now - j.createdAt.getTime() > WORKER_STALL_MS;
    }),
    dev,
  };
}

/**
 * Replace a machine transcript with the user's correction.
 *
 * This writes `transcript`, not `text`: the persona builder concatenates both
 * fields, so saving a correction as text would feed it the corrected and the
 * original wording together.
 */
export async function saveTranscript(actor: AnyActor, userId: string, key: string, transcript: string) {
  await user(actor, userId);
  if (!QUESTIONS.some((q) => q.key === key)) throw badRequest("Unknown question");
  await db
    .update(schema.onboardingAnswers)
    .set({ transcript: transcript.slice(0, 20_000) })
    .where(and(eq(schema.onboardingAnswers.userId, userId), eq(schema.onboardingAnswers.questionKey, key)));
}

/** Re-queue transcription for audio that is already stored. */
export async function retryTranscription(actor: AnyActor, userId: string, key: string) {
  await user(actor, userId);
  const a = await db.query.onboardingAnswers.findFirst({
    where: and(eq(schema.onboardingAnswers.userId, userId), eq(schema.onboardingAnswers.questionKey, key)),
  });
  if (!a?.audioUrl) throw badRequest("There is no recording to transcribe");
  await db
    .update(schema.onboardingAnswers)
    .set({ transcript: null })
    .where(and(eq(schema.onboardingAnswers.userId, userId), eq(schema.onboardingAnswers.questionKey, key)));
  const ext = a.audioUrl.split(".").pop()?.toLowerCase();
  const mime =
    ext === "m4a" || ext === "mp4" ? "audio/mp4" : ext === "ogg" ? "audio/ogg" : ext === "mp3" ? "audio/mpeg" : "audio/webm";
  return enqueue("transcribe_answer", userId, { key, storageKey: a.audioUrl, mime });
}

export async function addSample(actor: AnyActor, userId: string, text: string, source: string) {
  await user(actor, userId);
  const count = (await db.query.writingSamples.findMany({ where: eq(schema.writingSamples.userId, userId) })).length;
  if (count >= MAX_SAMPLES) throw conflict(`Up to ${MAX_SAMPLES} samples`);
  const clean = text.trim();
  if (clean.length < 40) throw badRequest("That sample is too short to learn from");
  const [row] = await db.insert(schema.writingSamples).values({ userId, text: clean.slice(0, 20_000), source: source.slice(0, 200) }).returning();
  return row;
}

export async function deleteSample(actor: AnyActor, userId: string, sampleId: string) {
  await user(actor, userId);
  await db.delete(schema.writingSamples).where(and(eq(schema.writingSamples.id, sampleId), eq(schema.writingSamples.userId, userId)));
}

/**
 * Completes the user's current step and moves to the next one. Returns a job id
 * when the next step needs AI work started (persona build, tone samples).
 */
export async function completeStep(actor: AnyActor, userId: string, step: number): Promise<{ step: number; jobId?: string }> {
  const u = await user(actor, userId);
  if (u.status === "active" || u.status === "paused") throw conflict("Setup is already complete");
  if (step !== u.onboardingStep) throw conflict(`You're on step ${u.onboardingStep}`);
  let jobId: string | undefined;

  if (step === 2) {
    if (!u.displayName || !u.timezone || !u.languages.length) throw badRequest("Complete your profile first");
  } else if (step === 3) {
    const answers = await db.query.onboardingAnswers.findMany({ where: eq(schema.onboardingAnswers.userId, userId) });
    const answered = answers.filter((a) => QUESTIONS.some((q) => q.key === a.questionKey) && ((a.text ?? "").trim() || a.audioUrl));
    if (answered.length < MIN_ANSWERS) throw badRequest(`Answer at least ${MIN_ANSWERS} questions`);
    if (answers.some((a) => a.audioUrl && !a.transcript)) throw conflict("A voice note is still being transcribed");
    jobId = await enqueue("persona_generate", userId, { by: actorRef(actor) });
  } else if (step === 4) {
    if (!(await activePersona(userId))) throw conflict("The persona isn't ready yet");
    const existing = await db.query.toneSamples.findMany({ where: eq(schema.toneSamples.userId, userId) });
    if (existing.length < SAMPLE_KINDS.length) jobId = await enqueue("tone_generate", userId, {});
  } else if (step === 5) {
    const tone = await db.query.toneSamples.findMany({ where: eq(schema.toneSamples.userId, userId) });
    if (tone.length < SAMPLE_KINDS.length || tone.some((t) => t.verdict !== "sounds_like_me"))
      throw conflict("Mark all three samples as “sounds like me” first");
  } else if (step === 6) {
    if (!(await db.query.cadences.findFirst({ where: eq(schema.cadences.userId, userId) }))) throw badRequest("Choose your posting cadence first");
    if (!u.whatsappVerifiedAt) throw conflict("Your WhatsApp number isn't verified");
  } else {
    throw conflict("There is no such step");
  }

  // Cadence is the last step: finishing it makes the account live, starts the
  // schedule and drafts the first post. The number was verified at sign-up.
  if (step === 6) {
    await db.update(schema.users).set({ status: "active", onboardingStep: 7 }).where(eq(schema.users.id, userId));
    const { generateSlots } = await import("./cadence");
    const { sendWelcome } = await import("../whatsapp/inbound");
    const { kickoffFirstDraft } = await import("./posts");
    await generateSlots(userId);
    const firstSlot = await kickoffFirstDraft(userId).catch(() => null);
    await sendWelcome(userId, { drafting: !!firstSlot }).catch(() => {});
    await audit(actor, { action: "onboarding.complete", entity: "user", entityId: userId, userId, after: { status: "active", firstSlot } });
    return { step: 7, jobId };
  }

  await db.update(schema.users).set({ onboardingStep: step + 1 }).where(eq(schema.users.id, userId));
  await audit(actor, { action: "onboarding.step", entity: "user", entityId: userId, userId, after: { completed: STEPS[step], next: STEPS[step + 1] } });
  return { step: step + 1, jobId };
}
