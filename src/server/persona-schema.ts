import { z } from "zod";

/** The persona every draft is written from. Stored as JSON on `personas.json`, versioned. */
export const personaSchema = z.object({
  display_name: z.string(),
  role_summary: z.string(),
  voice_summary: z.string().describe("Two or three plain-language sentences describing how this person writes"),
  audience: z.array(z.string()),
  content_pillars: z.array(z.object({ name: z.string(), description: z.string() })),
  voice: z.object({
    formality: z.number().min(0).max(1).describe("0 = conversational, 1 = formal"),
    personal: z.number().min(0).max(1).describe("0 = reserved, 1 = personal"),
    length: z.enum(["short", "medium", "long"]),
    emoji: z.enum(["none", "rare", "some"]),
    hashtags: z.string(),
    languages: z.array(z.string()),
    sentence_style: z.string(),
  }),
  signature_moves: z.array(z.string()),
  do: z.array(z.string()),
  dont: z.array(z.string()),
  banned_phrases: z.array(z.string()),
  topics_to_avoid: z.array(z.string()),
  golden_examples: z.array(z.object({ input: z.string(), post: z.string() })),
});

export type Persona = z.infer<typeof personaSchema>;

/** Onboarding questions (step 3). Each can be typed or recorded. */
export const QUESTIONS = [
  { key: "career_story", q: "Tell us your career story in a few sentences. What path brought you here?" },
  { key: "known_for", q: "What do you want to be known for?" },
  { key: "audience", q: "Who are you writing for? Peers, patients, partners, investors, policymakers — and why them?" },
  { key: "causes", q: "Which causes or issues do you care about most?" },
  { key: "topics_to_avoid", q: "Which topics should we never post about?" },
  { key: "formality", q: "How formal do you want to sound? Describe it in your own words." },
  { key: "proud_moment", q: "Describe a recent professional moment you're proud of." },
  { key: "contrarian_view", q: "What's a view you hold that others in your field might disagree with?" },
  { key: "influences", q: "Who or what shaped how you lead?" },
  { key: "personal_side", q: "How much of your personal life are you comfortable sharing?" },
  { key: "phrases", q: "Any phrases you use often? Any you can't stand?" },
  { key: "success", q: "A year from now, what would success on LinkedIn look like for you?" },
] as const;

export type QuestionKey = (typeof QUESTIONS)[number]["key"];

/** Tone preferences (also step 3), stored as onboarding_answers with a `pref.` prefix. */
export const PREF_KEYS = ["pref.formality", "pref.personal", "pref.length", "pref.emoji", "pref.hashtags"] as const;

export const SAMPLE_KINDS = [
  { kind: "professional_insight", prompt: "A professional insight from your work this month" },
  { kind: "personal_reflection", prompt: "A personal reflection on what keeps you in your field" },
  { kind: "event_milestone", prompt: "An event or milestone worth marking" },
] as const;
