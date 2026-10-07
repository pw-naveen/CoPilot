import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { actorRef, type AnyActor } from "../actor";
import * as ai from "../ai";
import { audit } from "../audit";
import { notFound, conflict } from "../errors";
import { personaSchema, QUESTIONS, type Persona } from "../persona-schema";
import { assertUserAccess } from "../scope";

export async function activePersona(userId: string) {
  return db.query.personas.findFirst({
    where: and(eq(schema.personas.userId, userId), eq(schema.personas.status, "active")),
    orderBy: desc(schema.personas.version),
  });
}

export async function requireActivePersona(userId: string) {
  const p = await activePersona(userId);
  if (!p) throw conflict("No persona yet");
  return { row: p, persona: p.json as Persona };
}

/** Writes a new version and makes it the active one. */
export async function savePersonaVersion(userId: string, json: Persona, createdBy: string, changeNote: string | null) {
  const persona = personaSchema.parse(json);
  return db.transaction(async (tx) => {
    const last = await tx.query.personas.findFirst({ where: eq(schema.personas.userId, userId), orderBy: desc(schema.personas.version) });
    const version = (last?.version ?? 0) + 1;
    await tx.update(schema.personas).set({ status: "retired" }).where(and(eq(schema.personas.userId, userId), eq(schema.personas.status, "active")));
    const [row] = await tx.insert(schema.personas).values({ userId, version, json: persona, status: "active", createdBy, changeNote }).returning();
    return row;
  });
}

export async function gatherPersonaInput(userId: string): Promise<ai.PersonaInput> {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) throw notFound();
  const answers = await db.query.onboardingAnswers.findMany({ where: eq(schema.onboardingAnswers.userId, userId) });
  const samples = await db.query.writingSamples.findMany({ where: eq(schema.writingSamples.userId, userId), orderBy: asc(schema.writingSamples.createdAt) });
  const current = await activePersona(userId);
  const text = (a: (typeof answers)[number]) => [a.text, a.transcript].filter(Boolean).join("\n").trim();
  return {
    profile: { display_name: u.displayName, title: u.title, org: u.org, specialty: u.specialty, languages: u.languages },
    answers: QUESTIONS.map((q) => {
      const a = answers.find((x) => x.questionKey === q.key);
      return { key: q.key, question: q.q, answer: a ? text(a) : "" };
    }).filter((a) => a.answer),
    prefs: Object.fromEntries(answers.filter((a) => a.questionKey.startsWith("pref.")).map((a) => [a.questionKey, a.text ?? ""])),
    samples: samples.map((s) => s.text),
    golden: (current?.json as Persona | undefined)?.golden_examples ?? [],
    previous: current?.json as Persona | undefined,
  };
}

/** Worker: build (or rebuild with a note) the persona from onboarding answers. */
export async function generatePersona(userId: string, note?: string, by = "system:synthesis") {
  const input = await gatherPersonaInput(userId);
  const { data } = await ai.synthesizePersona(userId, { ...input, note: note || undefined });
  data.golden_examples = input.golden; // golden examples are only ever added by approvals
  const row = await savePersonaVersion(userId, data, by, note ? `Regenerated: ${note}` : "Generated from onboarding");
  await audit({ type: "system", id: "persona" }, { action: "persona.generate", entity: "persona", entityId: row.id, userId, after: { version: row.version, note } });
  return { version: row.version };
}

export async function editPersona(actor: AnyActor, userId: string, json: Persona, note?: string) {
  await assertUserAccess(actor, userId);
  const before = await activePersona(userId);
  const row = await savePersonaVersion(userId, json, actorRef(actor), note ?? (actor.type === "staff" ? `Edited by ${actor.name}` : "Edited"));
  await audit(actor, { action: "persona.edit", entity: "persona", entityId: row.id, userId, before: before?.json, after: json });
  return row;
}

export async function listVersions(actor: AnyActor, userId: string) {
  await assertUserAccess(actor, userId);
  return db.query.personas.findMany({ where: eq(schema.personas.userId, userId), orderBy: desc(schema.personas.version) });
}

export async function restoreVersion(actor: AnyActor, userId: string, version: number) {
  await assertUserAccess(actor, userId);
  const v = await db.query.personas.findFirst({ where: and(eq(schema.personas.userId, userId), eq(schema.personas.version, version)) });
  if (!v) throw notFound();
  return editPersona(actor, userId, v.json as Persona, `Restored version ${version}`);
}

/** Apply a feedback comment to the persona (tone check and WhatsApp preferences). */
export async function applyPersonaFeedback(userId: string, post: string, verdict: string, comment: string, by: string) {
  const { persona } = await requireActivePersona(userId);
  const { data } = await ai.personaFeedback(userId, persona, post, verdict, comment);
  data.persona.golden_examples = persona.golden_examples;
  const row = await savePersonaVersion(userId, data.persona, by, comment || verdict);
  await audit({ type: "system", id: "persona" }, { action: "persona.feedback", entity: "persona", entityId: row.id, userId, after: { comment, version: row.version } });
  return { version: row.version, message: data.user_message, persona: data.persona };
}

export async function addGoldenExamples(userId: string, examples: Persona["golden_examples"], by: string, note: string) {
  const { persona } = await requireActivePersona(userId);
  const merged = [...examples, ...persona.golden_examples.filter((g) => !examples.some((e) => e.post === g.post))].slice(0, 12);
  return savePersonaVersion(userId, { ...persona, golden_examples: merged }, by, note);
}

