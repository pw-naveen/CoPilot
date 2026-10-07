import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { personaSchema, QUESTIONS } from "@/server/persona-schema";
import { call, cookieFor, resetDb, seedPeople } from "./helpers";
import * as stateRoute from "@/app/api/users/[userId]/onboarding/route";
import * as stepRoute from "@/app/api/users/[userId]/onboarding/step/route";
import * as profileRoute from "@/app/api/users/[userId]/profile/route";
import * as answerRoute from "@/app/api/users/[userId]/answers/[key]/route";
import * as audioRoute from "@/app/api/users/[userId]/answers/[key]/audio/route";
import * as samplesRoute from "@/app/api/users/[userId]/samples/route";
import * as personaRoute from "@/app/api/users/[userId]/persona/route";
import * as regenRoute from "@/app/api/users/[userId]/persona/generate/route";
import * as toneRoute from "@/app/api/users/[userId]/tone/[sampleId]/route";

describe("onboarding steps 2–5", () => {
  let userId: string;
  let cookie: string;
  const P = () => ({ userId });

  beforeEach(async () => {
    await resetDb();
    const { inScope } = await seedPeople();
    userId = inScope.id;
    cookie = await cookieFor("user", userId);
  });

  it("walks profile → voice → persona → tone check, resumable at every step", async () => {
    // Step 2: profile
    let r = await call(profileRoute.PUT, {
      method: "PUT",
      cookie,
      params: P(),
      body: { name: "Nanda Kumar", displayName: "Dr Nanda", title: "Director", org: "Mediwira", specialty: "Cardiology", linkedinUrl: "https://www.linkedin.com/in/nanda", languages: ["en", "mixed"], timezone: "Asia/Kuala_Lumpur" },
    });
    expect(r.status).toBe(200);
    expect((await call(stepRoute.POST, { cookie, params: P(), body: { step: 2 } })).json.step).toBe(3);

    // Resume: a fresh read shows the saved step
    expect((await call(stateRoute.GET, { cookie, params: P() })).json.user.onboardingStep).toBe(3);

    // Step 3: too few answers is refused
    r = await call(stepRoute.POST, { cookie, params: P(), body: { step: 3 } });
    expect(r.status).toBe(400);

    const answers: Record<string, string> = {
      career_story: "Trained in KL, twenty years in cardiology, now running Mediwira's heart programme.",
      known_for: "Preventive cardiology, team culture",
      audience: "healthcare peers, hospital partners, policymakers",
      causes: "Rural access to heart screening",
      topics_to_avoid: "Politics, my family",
      formality: "Warm but professional.",
    };
    for (const [key, text] of Object.entries(answers))
      expect((await call(answerRoute.PUT, { method: "PUT", cookie, params: { userId, key }, body: { text } })).status).toBe(200);
    for (const [key, text] of Object.entries({ "pref.formality": "0.4", "pref.personal": "0.7", "pref.length": "medium", "pref.emoji": "rare", "pref.hashtags": "max 3, at end" }))
      await call(answerRoute.PUT, { method: "PUT", cookie, params: { userId, key }, body: { text } });

    // A recorded answer is stored and transcribed
    const form = new FormData();
    form.set("audio", new File([new Uint8Array(4096)], "a.webm", { type: "audio/webm" }));
    r = await call(audioRoute.POST, { cookie, params: { userId, key: "proud_moment" }, form });
    expect(r.status).toBe(200);
    const ans = await db.query.onboardingAnswers.findFirst({ where: eq(schema.onboardingAnswers.questionKey, "proud_moment") });
    expect(ans?.audioUrl).toBeTruthy();
    expect(ans?.transcript).toContain("transcript");

    await call(samplesRoute.POST, { cookie, params: P(), body: { text: "Last week a junior nurse spotted what three of us missed. That's the culture I want: speak up, every time." } });

    r = await call(stepRoute.POST, { cookie, params: P(), body: { step: 3 } });
    expect(r.status).toBe(200);
    expect(r.json.step).toBe(4);

    // Step 4: persona is generated, valid against the schema, and versioned
    r = await call(personaRoute.GET, { cookie, params: P() });
    expect(r.json.active.version).toBe(1);
    const persona = personaSchema.parse(r.json.active.json);
    expect(persona.display_name).toBe("Dr Nanda");
    expect(persona.topics_to_avoid.join(" ")).toMatch(/Politics/);

    // edit → new version
    r = await call(personaRoute.PUT, { method: "PUT", cookie, params: P(), body: { json: { ...persona, dont: [...persona.dont, "No sports metaphors"] } } });
    expect(r.json.version).toBe(2);
    // invalid JSON is rejected
    expect((await call(personaRoute.PUT, { method: "PUT", cookie, params: P(), body: { json: { ...persona, voice: { formality: 3 } } } })).status).toBe(400);
    // regenerate with a note → new version that reflects it
    r = await call(regenRoute.POST, { cookie, params: P(), body: { note: "less corporate" } });
    expect(r.status).toBe(200);
    const v3 = (await call(personaRoute.GET, { cookie, params: P() })).json.active;
    expect(v3.version).toBe(3);
    expect(v3.json.voice.formality).toBeLessThan(persona.voice.formality);

    // Step 4 → 5 generates three samples
    r = await call(stepRoute.POST, { cookie, params: P(), body: { step: 4 } });
    expect(r.json.step).toBe(5);
    let state = (await call(stateRoute.GET, { cookie, params: P() })).json;
    expect(state.tone).toHaveLength(3);

    // Step 5: "close, adjust" updates the persona and regenerates that sample
    const [s1, s2, s3] = state.tone;
    r = await call(toneRoute.POST, { cookie, params: { userId, sampleId: s1.id }, body: { verdict: "close", comment: "Shorter please, and no hashtags" } });
    expect(r.json.done).toBe(false);
    state = (await call(stateRoute.GET, { cookie, params: P() })).json;
    const s1b = state.tone.find((t: { id: string }) => t.id === s1.id);
    expect(s1b.rounds).toBe(1);
    expect(s1b.verdict).toBeNull();
    expect(s1b.text).not.toMatch(/#/);
    expect(state.persona.json.voice.hashtags).toBe("none");

    // "not me" without a comment is refused
    expect((await call(toneRoute.POST, { cookie, params: { userId, sampleId: s2.id }, body: { verdict: "not_me" } })).status).toBe(409);

    // the step only completes when all three are approved
    await call(toneRoute.POST, { cookie, params: { userId, sampleId: s1.id }, body: { verdict: "sounds_like_me" } });
    await call(toneRoute.POST, { cookie, params: { userId, sampleId: s2.id }, body: { verdict: "sounds_like_me" } });
    expect((await call(stateRoute.GET, { cookie, params: P() })).json.user.onboardingStep).toBe(5);
    r = await call(toneRoute.POST, { cookie, params: { userId, sampleId: s3.id }, body: { verdict: "sounds_like_me" } });
    expect(r.json.done).toBe(true);

    state = (await call(stateRoute.GET, { cookie, params: P() })).json;
    expect(state.user.onboardingStep).toBe(6);
    expect(state.persona.json.golden_examples).toHaveLength(3);

    // every generation was logged with its prompt version
    const gens = await db.query.aiGenerations.findMany({ where: eq(schema.aiGenerations.userId, userId) });
    expect(gens.map((g) => g.promptVersion)).toEqual(expect.arrayContaining(["persona-synthesis.v1", "tone-samples.v1", "persona-feedback.v1"]));
  });

  it("covers every questionnaire key", () => {
    expect(QUESTIONS).toHaveLength(12);
  });
});
