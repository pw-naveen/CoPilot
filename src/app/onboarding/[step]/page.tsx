import { Fragment } from "react";
import { notFound, redirect } from "next/navigation";
import { userActor } from "@/server/page-auth";
import { onboardingState, STEPS } from "@/server/services/onboarding";
import { PREF_KEYS, QUESTIONS, SAMPLE_KINDS } from "@/server/persona-schema";
import { FlowShell } from "../flow-shell";
import { ProfileStep } from "./profile-step";
import { VoiceStep } from "./voice-step";
import { PersonaStep } from "./persona-step";
import { ToneStep } from "./tone-step";
import { CadenceStep } from "./cadence-step";
import { WhatsAppStep } from "./whatsapp-step";

export const dynamic = "force-dynamic";

export default async function StepPage({ params }: { params: Promise<{ step: string }> }) {
  const actor = await userActor();
  const { step: slug } = await params;
  const step = STEPS.indexOf(slug as (typeof STEPS)[number]);
  if (step < 2) notFound();
  const s = await onboardingState(actor, actor.id);
  const reached = s.user.onboardingStep;
  if (step > reached) redirect(`/onboarding/${STEPS[reached]}`);
  const editable = step === reached;

  // Step 3 runs its own shell: it drives the orb from live mic level and swaps
  // its footer per stage, which the generic frame cannot express.
  const Frame = step === 3 ? Fragment : FlowShell;
  const frameProps = step === 3 ? {} : { current: step, reached, name: s.user.displayName };

  return (
    <Frame {...frameProps}>
      {step === 2 && <ProfileStep user={s.user} editable={editable} />}
      {step === 3 && (
        <VoiceStep
          userId={actor.id}
          editable={editable}
          questions={QUESTIONS.map((q) => ({ key: q.key, q: q.q }))}
          answers={s.answers.map((a) => ({ key: a.questionKey, text: a.text ?? "", transcript: a.transcript, audio: a.audioSignedUrl }))}
          prefs={Object.fromEntries(PREF_KEYS.map((k) => [k, s.answers.find((a) => a.questionKey === k)?.text ?? ""]))}
          samples={s.samples.map((x) => ({ id: x.id, source: x.source, text: x.text }))}
        />
      )}
      {step === 4 && <PersonaStep userId={actor.id} editable={editable} persona={s.persona ? { version: s.persona.version, json: s.persona.json as never } : null} />}
      {step === 5 && (
        <ToneStep
          userId={actor.id}
          editable={editable}
          kinds={SAMPLE_KINDS.map((k) => ({ kind: k.kind, prompt: k.prompt }))}
          samples={s.tone.map((t) => ({ id: t.id, kind: t.kind, text: t.text, verdict: t.verdict, comment: t.comment, rounds: t.rounds, updatedAt: t.updatedAt.toISOString() }))}
          displayName={s.user.displayName}
          title={[s.user.title, s.user.org].filter(Boolean).join(" · ")}
        />
      )}
      {step === 6 && <CadenceStep userId={actor.id} editable={editable} timezone={s.user.timezone} cadence={s.cadence ? { postsPerWeek: s.cadence.postsPerWeek, weekdays: s.cadence.weekdays, times: s.cadence.times } : null} />}
      {step === 7 && <WhatsAppStep userId={actor.id} phone={s.user.phoneE164} verified={!!s.user.whatsappVerifiedAt} />}
    </Frame>
  );
}
