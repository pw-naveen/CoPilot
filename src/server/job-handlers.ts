import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import * as ai from "./ai";
import type { JobKind } from "./jobs";
import { storage } from "./storage";
import { generatePersona } from "./services/persona";
import { generateToneSamples, processToneFeedback } from "./services/tone";

type Handler = (userId: string, input: Record<string, unknown>) => Promise<unknown>;

export const handlers: Record<JobKind, Handler> = {
  async transcribe_answer(userId, input) {
    const { key, storageKey, mime } = input as { key: string; storageKey: string; mime: string };
    const audio = await storage().get(storageKey);
    const transcript = await ai.transcribe(userId, audio, mime);
    await db
      .update(schema.onboardingAnswers)
      .set({ transcript })
      .where(and(eq(schema.onboardingAnswers.userId, userId), eq(schema.onboardingAnswers.questionKey, key), eq(schema.onboardingAnswers.audioUrl, storageKey)));
    return { transcript };
  },
  persona_generate: (userId, input) => generatePersona(userId, input.note as string | undefined, (input.by as string) ?? "system:synthesis"),
  tone_generate: (userId) => generateToneSamples(userId),
  tone_feedback: (userId, input) => processToneFeedback(userId, input.sampleId as string, input.by as string),
};
