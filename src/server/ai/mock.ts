/**
 * Deterministic stand-in for OpenAI, used when no API key is configured. It follows
 * the same contracts as the real prompts closely enough to exercise every flow:
 * feedback changes the persona, review can fail, classification extracts dates.
 */
import { DateTime } from "luxon";
import type { Persona } from "../persona-schema";
import type { DraftImage, Intent, PersonaInput } from "./index";

const clamp = (n: number) => Math.max(0, Math.min(1, Math.round(n * 100) / 100));
const firstSentence = (s: string) => (s.split(/(?<=[.!?])\s/)[0] ?? s).trim();
const pick = (answers: PersonaInput["answers"], key: string) => answers.find((a) => a.key === key)?.answer?.trim() ?? "";
const splitList = (s: string) =>
  s
    .split(/[,;\n]| and /)
    .map((x) => x.trim().replace(/\.$/, ""))
    .filter((x) => x.length > 2)
    .slice(0, 6);

export function persona(input: PersonaInput): Persona {
  const a = input.answers;
  const prefs = input.prefs;
  const p = input.profile;
  const name = p.display_name;
  // A real model returns short pillar names. The mock only splits sentences, so
  // trim each to a label-length phrase; otherwise a whole paragraph ends up as a
  // pillar name, and the draft's hashtags are built from those names.
  const label = (t: string) => {
    const words = t.trim().split(/\s+/).slice(0, 5).join(" ").replace(/[.,;:]+$/, "");
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  const pillarsSrc = [...splitList(pick(a, "known_for")), ...splitList(pick(a, "causes"))].slice(0, 4);
  const pillars = (pillarsSrc.length ? pillarsSrc : ["Leadership in healthcare", "Patient-centred care", "Building teams"]).map((n) => ({
    name: label(n),
    description: `Posts about ${n.toLowerCase().slice(0, 140)}, drawn from ${name}'s own work.`,
  }));
  const formality = clamp(Number(prefs["pref.formality"] ?? 0.5));
  const personal = clamp(Number(prefs["pref.personal"] ?? 0.5));
  const length = (["short", "medium", "long"].includes(prefs["pref.length"]) ? prefs["pref.length"] : "medium") as Persona["voice"]["length"];
  const emoji = (["none", "rare", "some"].includes(prefs["pref.emoji"]) ? prefs["pref.emoji"] : "rare") as Persona["voice"]["emoji"];
  const hashtags = prefs["pref.hashtags"] || "max 3, at end";
  const avoid = splitList(pick(a, "topics_to_avoid"));
  const audience = splitList(pick(a, "audience"));
  let base: Persona = {
    display_name: name,
    role_summary: [p.title, p.specialty && `in ${p.specialty}`, p.org && `at ${p.org}`].filter(Boolean).join(" ") || "Senior healthcare leader",
    voice_summary: `You write ${formality > 0.6 ? "in a measured, formal register" : formality < 0.4 ? "conversationally, like talking to a colleague" : "plainly and warmly"}, ${personal > 0.6 ? "and you let personal moments in" : "keeping the focus on the work"}. ${input.samples.length ? "Your samples open with a concrete moment and end on a clear takeaway." : "You favour clear, concrete points over big claims."}`,
    audience: audience.length ? audience : ["healthcare peers", "hospital partners"],
    content_pillars: pillars,
    voice: {
      formality,
      personal,
      length,
      emoji,
      hashtags,
      languages: p.languages.length ? p.languages : ["en"],
      sentence_style: formality > 0.6 ? "Complete sentences, few contractions" : "Short sentences, contractions welcome",
    },
    signature_moves: input.samples.length ? ["Opens with a short, patient-free anecdote", "Ends with one clear takeaway"] : ["Leads with the point, then one example"],
    do: ["Use concrete details from the input", "Keep one idea per post"],
    dont: ["Don't use buzzwords", "Don't make claims about treatment outcomes"],
    banned_phrases: ["I'm thrilled to announce", "game-changer", "synergy", ...splitList(pick(a, "phrases").split(/can't stand|dislike|hate/i)[1] ?? "")],
    topics_to_avoid: [...avoid, "identifiable patient details"],
    golden_examples: input.golden,
  };
  if (input.note && input.previous) base = applyFeedback({ ...input.previous, golden_examples: input.golden }, input.note).persona;
  return base;
}

export function applyFeedback(p: Persona, comment: string): { persona: Persona; user_message: string } {
  const c = comment.toLowerCase();
  const next: Persona = structuredClone(p);
  const changes: string[] = [];
  if (/short|concise|brief|too long|less/.test(c)) {
    next.voice.length = next.voice.length === "long" ? "medium" : "short";
    changes.push("keep posts shorter");
  }
  if (/long|more detail|expand/.test(c) && !/too long/.test(c)) {
    next.voice.length = next.voice.length === "short" ? "medium" : "long";
    changes.push("add more detail");
  }
  if (/corporate|stiff|formal/.test(c)) {
    next.voice.formality = clamp(next.voice.formality - 0.2);
    changes.push("sound less corporate");
  }
  if (/casual|informal/.test(c)) {
    next.voice.formality = clamp(next.voice.formality + 0.2);
    changes.push("sound more formal");
  }
  if (/hashtag/.test(c)) {
    next.voice.hashtags = "none";
    changes.push("skip hashtags");
  }
  if (/emoji/.test(c)) {
    next.voice.emoji = "none";
    changes.push("leave out emoji");
  }
  if (/personal|warm/.test(c)) {
    next.voice.personal = clamp(next.voice.personal + 0.2);
    changes.push("be a little more personal");
  }
  if (comment.trim()) next.do = [...next.do.filter((d) => d !== comment.trim()), comment.trim()].slice(-12);
  return { persona: next, user_message: changes.length ? `Got it. I'll ${changes.join(" and ")}.` : "Noted. I'll write that way from now on." };
}

export function refresh(p: Persona, edits: { before: string; after: string | null; feedback: string | null }[]) {
  const shorter = edits.filter((e) => e.after && e.after.length < e.before.length * 0.85).length;
  if (shorter >= Math.ceil(edits.length / 2)) {
    const next = structuredClone(p);
    next.voice.length = next.voice.length === "long" ? "medium" : "short";
    next.do = [...next.do, "Keep openings to one short sentence"];
    return { persona: next, user_message: "I've noticed you prefer shorter posts; I'll write that way now." };
  }
  const fb = edits.map((e) => e.feedback).filter(Boolean).join(" ");
  if (fb) return applyFeedback(p, fb);
  return { persona: p, user_message: "" };
}

function lengthWords(p: Persona) {
  return p.voice.length === "short" ? 1 : p.voice.length === "medium" ? 2 : 3;
}

function compose(p: Persona, topic: string, angle: string) {
  const opener = p.voice.formality > 0.6 ? `${firstSentence(topic)}` : `Something I keep coming back to: ${firstSentence(topic).replace(/^./, (m) => m.toLowerCase())}`;
  const body = [
    `${angle}`,
    `In our work, the details matter more than the headline. That's where the real lessons are.`,
    `It's a reminder that good care is built by teams, not individuals.`,
  ].slice(0, lengthWords(p));
  const close = p.voice.personal > 0.6 ? "Grateful to the people who make this possible." : "What's your experience been?";
  const tags =
    p.voice.hashtags === "none" ? "" : `\n\n${p.content_pillars.slice(0, 3).map((c) => "#" + c.name.replace(/[^A-Za-z0-9]/g, "")).join(" ")}`;
  return `${opener}\n\n${body.join("\n\n")}\n\n${close}${tags}`;
}

export function toneSamples(p: Persona, prompts: { kind: string; prompt: string }[]) {
  const pillar = (i: number) => p.content_pillars[i % Math.max(1, p.content_pillars.length)]?.name ?? "our work";
  return {
    samples: prompts.map((pr, i) => ({
      kind: pr.kind,
      text: compose(
        p,
        pr.kind === "professional_insight"
          ? `${pillar(i)} is easy to talk about and hard to do well.`
          : pr.kind === "personal_reflection"
            ? `Why I still do this work, years in.`
            : `This month marks a milestone for our team.`,
        `Here is what ${pillar(i).toLowerCase()} looks like in practice.`,
      ),
    })),
  };
}

const APPROVE = /^(ok(ay)?|approve[d]?|looks good|lgtm|yes|go ahead|perfect|great|👍|✅)[.! ]*$/i;
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function classify(text: string, ctx: { pendingDraft: boolean; today: string; timezone: string; hasMedia: boolean }): Intent {
  const t = text.trim();
  const lower = t.toLowerCase();
  const base: Intent = { intent: "other", topic: "", requested_date: "", feedback: "", preference: "", question: "", enough_detail: false, follow_up: "" };
  if (ctx.pendingDraft && APPROVE.test(t)) return { ...base, intent: "approval" };
  if (/\b(stop|never|always|don'?t (ever )?use|no more)\b/.test(lower) && /\b(hashtag|emoji|mention|use|write|sound)/.test(lower) && !/\bpost\b.*\babout\b/.test(lower))
    return { ...base, intent: "persona_preference", preference: t };
  if (ctx.pendingDraft && /^(make|change|shorter|longer|less|more|remove|add|can you|please (make|change|remove|add)|tone|too )/.test(lower))
    return { ...base, intent: "feedback", feedback: t };
  const asks = /\?\s*$/.test(t) && /^(when|what|how|why|who|where|which|is|are|do|does|did|can|could|will|should)\b/.test(lower);
  if (asks && !/^(can|could) you (write|post|draft)/.test(lower)) return { ...base, intent: "question", question: t };
  if (/^(hi|hello|hey|thanks|thank you|thx)[.! ]*$/i.test(t)) return base;

  let requested = "";
  const today = DateTime.fromISO(ctx.today, { zone: ctx.timezone });
  // Only a day the post should go out on counts ("post this on Friday"), not when something happened.
  const dayWanted = lower.match(new RegExp(`\\b(?:post|publish|share|schedule|put)\\b[^.?!]*?\\b(?:on|for)\\s+(?:this\\s+|next\\s+)?(${WEEKDAYS.join("|")})`)) ?? lower.match(new RegExp(`^for (?:this |next )?(${WEEKDAYS.join("|")})`));
  const wd = dayWanted ? WEEKDAYS.indexOf(dayWanted[1]) : -1;
  if (wd >= 0) {
    let d = today.plus({ days: 1 });
    while (d.weekday !== wd + 1) d = d.plus({ days: 1 });
    requested = d.toISODate()!;
  }
  const m = lower.match(/\b(\d{1,2})(st|nd|rd|th)\b/);
  if (!requested && m) {
    let d = today.set({ day: Number(m[1]) });
    if (d < today) d = d.plus({ months: 1 });
    requested = d.toISODate()!;
  }
  const words = t.split(/\s+/).filter(Boolean).length;
  const enough = words >= 6 || (ctx.hasMedia && words >= 2);
  return {
    ...base,
    intent: "new_idea",
    topic: t.slice(0, 200),
    requested_date: requested,
    enough_detail: enough,
    follow_up: enough ? "" : "Love it. Can you tell me a bit more: what happened, and what's the one thing you want people to take away?",
  };
}

export function answer(question: string, schedule: string) {
  if (/when|next|schedule|post/i.test(question)) return `Here's what's coming up:\n${schedule || "Nothing scheduled yet."}`;
  return "Send me a topic, photo, event or voice note any time and I'll turn it into a draft for you to approve.";
}

export function draft(a: { persona: Persona; input: string; images: DraftImage[]; issues?: string[] }) {
  const lines = a.input.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("(photo)"));
  const lead = lines[0] ?? a.input;
  const rest = lines.slice(1).join(" ").replace(/\(voice note\)\s*/g, "");
  let text = compose(a.persona, lead, rest ? `What stayed with me: ${rest.slice(0, 220)}` : "What stayed with me was how much a small, well-run effort can do.");
  if (a.issues?.length) text = text.replace(/guarantee[sd]?|cure[sd]?/gi, "support");
  return {
    text,
    image_ids: a.images.filter((i) => i.consent || !/patient/i.test(i.description)).slice(0, 4).map((i) => i.id),
    first_comment: "",
    summary: `A post about ${lead.split(/[.,]/)[0].slice(0, 70).trim().replace(/^./, (c) => c.toLowerCase())}`,
  };
}

export function review(a: { persona: Persona; text: string; images: DraftImage[] }) {
  const issues: string[] = [];
  if (/guarantee|cure[sd]?\b|100% (success|effective)/i.test(a.text)) issues.push("Remove the treatment claim or guarantee of outcome.");
  if (/book (now|an appointment)|call us|discount|promo/i.test(a.text)) issues.push("Remove wording that advertises a service.");
  for (const b of a.persona.banned_phrases) if (b && a.text.toLowerCase().includes(b.toLowerCase())) issues.push(`Remove the banned phrase "${b}".`);
  if (a.persona.voice.hashtags === "none" && /#\w/.test(a.text)) issues.push("Remove hashtags; this person doesn't use them.");
  return { pass: issues.length === 0, issues };
}

export function revise(a: { persona: Persona; text: string; feedback: string }) {
  const f = a.feedback.toLowerCase();
  let text = a.text;
  if (/short|concise|brief|too long/.test(f)) text = text.split("\n\n").filter((_, i, arr) => i === 0 || i === arr.length - 1 || i === 1).join("\n\n");
  if (/hashtag/.test(f)) text = text.replace(/\n*(#\w+\s?)+$/g, "").trim();
  if (text === a.text) text = `${text.split("\n\n")[0]}\n\n(${a.feedback.trim()})\n\n${text.split("\n\n").slice(1).join("\n\n")}`;
  return { text, summary: `Revised: ${a.feedback.slice(0, 60)}`, first_comment: "" };
}

/**
 * Plausible spoken answers, one per question. The mock can't hear the audio, so
 * returning a placeholder would feed that placeholder into the persona and make
 * every voice-recorded setup produce nonsense. Answer-shaped text keeps the rest
 * of the pipeline meaningful in development; a real key gives real transcripts.
 */
const SPOKEN: Record<string, string> = {
  career_story:
    "So I trained in general medicine first, and I spent a few years in a district hospital before I specialised. That period shaped everything really — you see what happens when people can't reach care in time. I moved into my specialty because I wanted to be closer to that problem, and I've been doing it about fifteen years now.",
  known_for:
    "I'd want to be known for the preventive side of the work, honestly. Not the dramatic stuff. The thing that actually changes outcomes happens years before anyone ends up in front of me, and I don't think we talk about that enough.",
  audience:
    "Mostly peers, and people who make policy decisions. I'm not really trying to reach patients directly — there are others doing that better. I want the conversation to be with the people who can change how the system works.",
  causes:
    "Access, mainly. The fact that where someone lives predicts their outcome more than almost anything clinical. And I care a lot about how exhausted the junior doctors are, because that's a safety issue nobody wants to name.",
  topics_to_avoid:
    "No politics, definitely. Nothing about individual patients even if it's anonymised. And I don't want to be seen endorsing any particular product or private group.",
  formality:
    "Somewhere in the middle. Like I'm talking to a colleague, not giving a lecture and not performing. Plain language. I'd rather be clear than sound clever.",
  proud_moment:
    "We set up a triage pathway at a couple of smaller hospitals last year. It's not glamorous, it's a protocol and a phone line really, but it cut the delay for transferred patients quite significantly. No award for it, but it's the best thing I've done.",
  contrarian_view:
    "I think we overvalue the procedural side and undervalue the unglamorous preventive work. A lot of what I do is salvage for a failure that happened a decade earlier. Most of my colleagues would find that an uncomfortable thing to say out loud.",
  influences:
    "A consultant I worked under early on. He did his rounds very early so he'd be there when families came, and he never raised his voice at anyone junior. I learned that most of leading is just turning up reliably and being safe to tell the truth to.",
  personal_side:
    "A little, where it's relevant. I'll talk about burnout, or the drive home after a bad day. I won't post about my family or my holidays, and definitely no photos of my children.",
  phrases:
    "I say the distance between things a lot — between the guideline and the ward, that kind of phrasing. I can't stand humbled to, or game-changer, or calling illness a battle. People aren't fighting anything, they're living with something.",
  success:
    "A few hundred of the right people reading properly, rather than thousands scrolling past. If one policy conversation came out of something I wrote, that would be enough. I've no interest in going viral.",
};

export function transcript(audio: Buffer, questionKey?: string) {
  const spoken = questionKey ? SPOKEN[questionKey] : undefined;
  if (spoken) return spoken;
  return `Voice note transcript (${Math.max(1, Math.round(audio.length / 1024))} KB of audio). In development the mock transcriber can't hear audio; set an OpenAI key for real transcripts.`;
}
