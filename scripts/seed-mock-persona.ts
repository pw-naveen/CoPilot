/**
 * Fills a user's profile + voice questionnaire with mock answers so setup can be
 * clicked through to the persona step. Dev only.
 *
 *   npx tsx scripts/seed-mock-persona.ts [email]   (default: nanda@example.com)
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { SYSTEM } from "../src/server/actor";
import { saveAnswer, saveProfile, completeStep } from "../src/server/services/onboarding";

const email = process.argv[2] || "nanda@example.com";

const PROFILE = {
  name: "Dr Nanda",
  displayName: "Dr Nanda",
  title: "Consultant Interventional Cardiologist",
  org: "Pusat Jantung, Kuala Lumpur",
  specialty: "Interventional cardiology",
  linkedinUrl: "https://www.linkedin.com/in/dr-nanda-example/",
  languages: ["mixed" as const],
  timezone: "Asia/Kuala_Lumpur",
};

const ANSWERS: Record<string, string> = {
  career_story:
    "I started in general medicine at a district hospital in Kedah, where the nearest cath lab was a four-hour transfer away. I watched people die in that four hours. That's the entire reason I went into interventional cardiology — not because stents are interesting, but because the distance between a patient and a working cath lab is a policy decision, not a medical one. Fifteen years later I'm a consultant in Kuala Lumpur, and I still mostly think about the people who never make it to my table.",
  known_for:
    "Being the cardiologist who talks about prevention when everyone else is talking about procedures. I've built a career on intervention and I'd like to make most of it unnecessary. If people remember one thing, I want it to be that the most important cardiac intervention happens twenty years before the chest pain.",
  audience:
    "Primarily peers and policymakers, in that order. Peers because the culture inside cardiology still rewards the dramatic save over the boring prevention, and that's a conversation we have to have with each other. Policymakers because almost everything that would actually move cardiac mortality in this country is a budget line, not a clinical decision. I'm not really writing for patients — there are better people doing that, and I don't want to flatten complex things into reassurance.",
  causes:
    "Access to cardiac care outside the Klang Valley. The absurdity of a country where your postcode predicts your survival more reliably than your ejection fraction. Also: the quiet exhaustion of junior doctors in the public system, which nobody wants to name as a patient-safety issue, and the creeping privatisation of services that should never have been a market.",
  topics_to_avoid:
    "Party politics — never. Individual patient cases, even anonymised; I don't believe consent is meaningful when there's a power gradient that steep. Anything that reads as an endorsement of a device, drug or private hospital group. Other named clinicians' clinical judgement. And no engagement-bait about doctors' salaries.",
  formality:
    "Like I'm talking to a respected colleague over coffee, not presenting at a conference and not performing on the internet. Plain words for complicated things. I'd rather be clear than impressive. No “thrilled to announce”, no inspirational cadence, no sentences that are one word long for emphasis. If a sentence sounds like a LinkedIn sentence, it isn't mine.",
  proud_moment:
    "We got a nurse-led rapid chest-pain triage running at two district hospitals last year. It isn't glamorous — it's a protocol, a phone line, and a lot of training. Door-to-balloon times for transferred patients dropped by about forty minutes. No paper, no award, no press. Forty minutes of myocardium, repeatedly, for people I'll never meet. That's the best thing I've done.",
  contrarian_view:
    "That we vastly over-value the cath lab and under-value the pharmacist. A great deal of what I do is salvage for a system that failed the patient a decade earlier, and we've built enormous professional prestige around the salvage. I'd trade a third of our interventional capacity for properly resourced community statin and hypertension programmes, and I think most of my colleagues would find that heretical.",
  influences:
    "A consultant in Alor Setar who did ward rounds at 6am so he could be present when families visited, and who never once raised his voice at a house officer. He taught me that most of leadership is just showing up reliably and being safe to tell the truth to. Beyond that: Atul Gawande for the writing, and years of running a department badly before learning to run it adequately.",
  personal_side:
    "Sparingly, and only where it's load-bearing. I'll talk about burnout, about the drive home after losing a patient, about being the child of a parent with heart disease — because those are relevant. I won't post about my family, my holidays, or my children. No photos of them, ever.",
  phrases:
    "I say “the distance between” a lot — between the guideline and the ward, between the policy and the patient. Also “that's a budget decision, not a medical one.” I can't stand “humbled to”, “game-changer”, “at the end of the day”, and any use of “warrior” or “battle” about illness. Patients with heart failure aren't fighting anything; they're living with something.",
  success:
    "A few hundred of the right people reading carefully, rather than a few thousand scrolling past. Concretely: one policy conversation about rural cath-lab access that I can trace back to something I wrote, and two or three junior doctors telling me they went into cardiology for the prevention side. I have no interest in being an influencer, and a viral post would make me nervous rather than pleased.",
  "pref.formality": "0.6",
  "pref.personal": "0.35",
  "pref.length": "medium",
  "pref.emoji": "none",
  "pref.hashtags": "max 2, at end",
};

const u = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
if (!u) {
  console.error(`No user ${email}. Run npm run db:seed first.`);
  process.exit(1);
}

await saveProfile(SYSTEM, u.id, PROFILE);
console.log(`profile saved for ${email}`);

for (const [key, text] of Object.entries(ANSWERS)) await saveAnswer(SYSTEM, u.id, key, text);
console.log(`${Object.keys(ANSWERS).length} answers saved`);

// Claim the invite ourselves. The first real login only promotes users whose
// status is still "invited" (auth.ts), so doing it here stops a later sign-in
// from resetting the progress we're about to make.
let step = u.onboardingStep;
if (u.status === "invited" || step < 2) {
  await db.update(schema.users).set({ status: "onboarding", onboardingStep: 2 }).where(eq(schema.users.id, u.id));
  step = 2;
}
while (step < 4) {
  const r = await completeStep(SYSTEM, u.id, step);
  console.log(`completed step ${step} -> ${r.step}${r.jobId ? ` (job ${r.jobId})` : ""}`);
  step = r.step;
}

console.log(`\nDone. ${email} is on step ${step} (persona review).`);
process.exit(0);
