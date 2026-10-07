import OpenAI, { toFile } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { db, schema } from "@/db";
import { getSetting, models } from "../config";
import { personaSchema, type Persona } from "../persona-schema";
import { fill, loadPrompt } from "./prompts";
import * as mock from "./mock";

/**
 * Every OpenAI call in the system. Each is a separate prompt (versioned file in
 * /prompts) with JSON output validated against a schema. With no API key set, a
 * deterministic mock answers instead so development and tests run offline.
 */

let client: { key: string; c: OpenAI } | null = null;
async function openai(): Promise<OpenAI | null> {
  if (process.env.AI_PROVIDER === "mock") return null;
  const key = await getSetting("openai.api_key");
  if (!key) return null;
  if (client?.key !== key) client = { key, c: new OpenAI({ apiKey: key }) };
  return client.c;
}

export type Gen<T> = { data: T; promptVersion: string; model: string };

async function log(row: { userId?: string | null; kind: string; promptVersion: string; model: string; ok: boolean; error?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } | null; started: number }) {
  await db.insert(schema.aiGenerations).values({
    userId: row.userId ?? null,
    kind: row.kind,
    promptVersion: row.promptVersion,
    model: row.model,
    ok: row.ok,
    error: row.error ?? null,
    inputTokens: row.usage?.prompt_tokens ?? null,
    outputTokens: row.usage?.completion_tokens ?? null,
    latencyMs: Date.now() - row.started,
  });
}

async function structured<S extends z.ZodTypeAny>(opts: {
  kind: string;
  prompt: string;
  vars: Record<string, string>;
  user: string;
  schema: S;
  model: string;
  userId?: string | null;
  mock: () => z.infer<S>;
}): Promise<Gen<z.infer<S>>> {
  const p = loadPrompt(opts.prompt);
  const started = Date.now();
  const ai = await openai();
  if (!ai) {
    const data = opts.schema.parse(opts.mock());
    await log({ userId: opts.userId, kind: opts.kind, promptVersion: p.version, model: "mock", ok: true, started });
    return { data, promptVersion: p.version, model: "mock" };
  }
  try {
    const res = await ai.chat.completions.parse({
      model: opts.model,
      messages: [
        { role: "system", content: fill(p.text, opts.vars) },
        { role: "user", content: opts.user },
      ],
      response_format: zodResponseFormat(opts.schema, opts.kind),
    });
    const msg = res.choices[0]?.message;
    if (!msg?.parsed) throw new Error(msg?.refusal ?? "empty response");
    await log({ userId: opts.userId, kind: opts.kind, promptVersion: p.version, model: opts.model, ok: true, usage: res.usage, started });
    return { data: msg.parsed as z.infer<S>, promptVersion: p.version, model: opts.model };
  } catch (err) {
    await log({ userId: opts.userId, kind: opts.kind, promptVersion: p.version, model: opts.model, ok: false, error: String(err), started });
    throw err;
  }
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

// ── Persona ───────────────────────────────────────────────────────────────

export type PersonaInput = {
  profile: { display_name: string; title?: string | null; org?: string | null; specialty?: string | null; languages: string[] };
  answers: { key: string; question: string; answer: string }[];
  prefs: Record<string, string>;
  samples: string[];
  golden: Persona["golden_examples"];
  note?: string;
  previous?: Persona;
};

export function synthesizePersona(userId: string, input: PersonaInput) {
  return structured({
    kind: "persona_synthesis",
    prompt: "persona-synthesis",
    vars: {
      note: input.note
        ? `The person reviewed the previous version and asked: "${input.note}". Apply this.\nPrevious version:\n${json(input.previous)}`
        : "",
    },
    user: json({ profile: input.profile, answers: input.answers, tone_preferences: input.prefs, writing_samples: input.samples, golden_examples: input.golden }),
    schema: personaSchema,
    model: models().draft,
    userId,
    mock: () => mock.persona(input),
  });
}

const toneSchema = z.object({ samples: z.array(z.object({ kind: z.string(), text: z.string() })) });

export function toneSamples(userId: string, persona: Persona, prompts: { kind: string; prompt: string }[]) {
  return structured({
    kind: "sample_generation",
    prompt: "tone-samples",
    vars: { persona: json(persona) },
    user: `Write one post for each of these prompt types:\n${prompts.map((p) => `- ${p.kind}: ${p.prompt}`).join("\n")}`,
    schema: toneSchema,
    model: models().draft,
    userId,
    mock: () => mock.toneSamples(persona, prompts),
  });
}

const personaUpdateSchema = z.object({ persona: personaSchema, user_message: z.string() });

export function personaFeedback(userId: string, persona: Persona, post: string, verdict: string, comment: string) {
  return structured({
    kind: "persona_feedback",
    prompt: "persona-feedback",
    vars: { persona: json(persona), post, verdict, comment },
    user: comment || verdict,
    schema: personaUpdateSchema,
    model: models().draft,
    userId,
    mock: () => mock.applyFeedback(persona, comment),
  });
}

export function refreshPersona(userId: string, persona: Persona, edits: { before: string; after: string | null; feedback: string | null }[]) {
  return structured({
    kind: "persona_refresh",
    prompt: "persona-refresh",
    vars: { persona: json(persona), edits: json(edits) },
    user: "Update the persona from these edits.",
    schema: personaUpdateSchema,
    model: models().draft,
    userId,
    mock: () => mock.refresh(persona, edits),
  });
}

// ── WhatsApp intent ───────────────────────────────────────────────────────

export const intentSchema = z.object({
  intent: z.enum(["new_idea", "feedback", "approval", "persona_preference", "question", "other"]),
  topic: z.string(),
  requested_date: z.string(),
  feedback: z.string(),
  preference: z.string(),
  question: z.string(),
  enough_detail: z.boolean(),
  follow_up: z.string(),
});
export type Intent = z.infer<typeof intentSchema>;

export function classifyIntent(userId: string, text: string, ctx: { pendingDraft: boolean; today: string; timezone: string; hasMedia: boolean }) {
  return structured({
    kind: "intent_classification",
    prompt: "intent-classification",
    vars: { pending_draft: ctx.pendingDraft ? "currently" : "not", today: ctx.today, timezone: ctx.timezone },
    user: text + (ctx.hasMedia ? "\n[The user also attached images or documents.]" : ""),
    schema: intentSchema,
    model: models().classify,
    userId,
    mock: () => mock.classify(text, ctx),
  });
}

const answerSchema = z.object({ answer: z.string() });
export function answerQuestion(userId: string, question: string, scheduleText: string) {
  return structured({
    kind: "question_answer",
    prompt: "question-answer",
    vars: { schedule: scheduleText },
    user: question,
    schema: answerSchema,
    model: models().classify,
    userId,
    mock: () => ({ answer: mock.answer(question, scheduleText) }),
  });
}

// ── Drafts ────────────────────────────────────────────────────────────────

export type DraftImage = { id: string; description: string; consent: boolean };

const draftSchema = z.object({
  text: z.string(),
  image_ids: z.array(z.string()),
  first_comment: z.string(),
  summary: z.string(),
});
export type Draft = z.infer<typeof draftSchema>;

export function generateDraft(
  userId: string,
  a: { persona: Persona; input: string; recent: string[]; slotDate: string; images: DraftImage[]; issues?: string[] },
) {
  return structured({
    kind: "draft_generation",
    prompt: "draft-generation",
    vars: {
      persona: json(a.persona),
      recent: a.recent.length ? a.recent.map((r, i) => `${i + 1}. ${r.slice(0, 280)}`).join("\n") : "(none yet)",
      slot_date: a.slotDate,
      issues: a.issues?.length ? `A previous attempt failed review. Fix these issues:\n- ${a.issues.join("\n- ")}` : "",
    },
    user: `Input:\n${a.input}\n\nImages:\n${a.images.length ? a.images.map((i) => `- id=${i.id} consent=${i.consent}: ${i.description}`).join("\n") : "(none)"}`,
    schema: draftSchema,
    model: models().draft,
    userId,
    mock: () => mock.draft(a),
  });
}

const reviewSchema = z.object({ pass: z.boolean(), issues: z.array(z.string()) });

export function reviewDraft(userId: string, a: { persona: Persona; input: string; text: string; images: DraftImage[] }) {
  return structured({
    kind: "review_pass",
    prompt: "draft-review",
    vars: { persona: json(a.persona), input: a.input, images: a.images.map((i) => `${i.id}: consent=${i.consent}; ${i.description}`).join("; ") || "none" },
    user: a.text,
    schema: reviewSchema,
    model: models().classify,
    userId,
    mock: () => mock.review(a),
  });
}

const revisionSchema = z.object({ text: z.string(), summary: z.string(), first_comment: z.string() });

export function reviseDraft(userId: string, a: { persona: Persona; text: string; feedback: string }) {
  return structured({
    kind: "revision",
    prompt: "draft-revision",
    vars: { persona: json(a.persona), feedback: a.feedback },
    user: a.text,
    schema: revisionSchema,
    model: models().draft,
    userId,
    mock: () => mock.revise(a),
  });
}

// ── Media ─────────────────────────────────────────────────────────────────

export async function transcribe(userId: string | null, audio: Buffer, mime: string): Promise<string> {
  const ai = await openai();
  const model = models().transcribe;
  const started = Date.now();
  if (!ai) {
    await log({ userId, kind: "speech_to_text", promptVersion: "n/a", model: "mock", ok: true, started });
    return mock.transcript(audio);
  }
  try {
    const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("mpeg") ? "mp3" : "webm";
    const res = await ai.audio.transcriptions.create({ file: await toFile(audio, `voice.${ext}`, { type: mime }), model });
    await log({ userId, kind: "speech_to_text", promptVersion: "n/a", model, ok: true, started });
    return res.text;
  } catch (err) {
    await log({ userId, kind: "speech_to_text", promptVersion: "n/a", model, ok: false, error: String(err), started });
    throw err;
  }
}

export async function describeImage(userId: string | null, image: Buffer, mime: string): Promise<string> {
  const ai = await openai();
  const p = loadPrompt("image-description");
  const model = models().vision;
  const started = Date.now();
  if (!ai) {
    await log({ userId, kind: "vision", promptVersion: p.version, model: "mock", ok: true, started });
    return "A photo shared by the user.";
  }
  try {
    const res = await ai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: p.text },
        { role: "user", content: [{ type: "image_url", image_url: { url: `data:${mime};base64,${image.toString("base64")}` } }] },
      ],
    });
    await log({ userId, kind: "vision", promptVersion: p.version, model, ok: true, usage: res.usage, started });
    return res.choices[0]?.message?.content?.trim() ?? "";
  } catch (err) {
    await log({ userId, kind: "vision", promptVersion: p.version, model, ok: false, error: String(err), started });
    throw err;
  }
}
