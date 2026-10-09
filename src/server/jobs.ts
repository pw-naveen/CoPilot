import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { addJob } from "./queue";

/**
 * On-demand work the web app hands to the worker (AI calls, transcription). The
 * browser polls the `jobs` row. With JOBS_INLINE=1 (tests) the job runs in-process.
 */
export type JobKind = "transcribe_answer" | "persona_generate" | "tone_generate" | "tone_feedback" | "wa_check" | "wa_register_webhook";

export async function enqueue(kind: JobKind, userId: string | null, input: Record<string, unknown>) {
  const [row] = await db.insert(schema.jobs).values({ kind, userId, input }).returning();
  if (process.env.JOBS_INLINE === "1") await runJob(row.id);
  else await addJob("jobs", kind, { id: row.id }, { jobId: row.id, attempts: 2, backoff: { type: "exponential", delay: 3000 } });
  return row.id;
}

export async function runJob(id: string) {
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) });
  if (!job || job.status === "done") return;
  await db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, id));
  try {
    const { handlers } = await import("./job-handlers");
    const result = await handlers[job.kind as JobKind](job.userId as string, (job.input ?? {}) as Record<string, unknown>);
    await db.update(schema.jobs).set({ status: "done", result: result ?? null }).where(eq(schema.jobs.id, id));
  } catch (err) {
    console.error(`[job ${job.kind}]`, err);
    // Two messages: one safe to put in front of anyone, and the real one. The
    // detail is always recorded — a failure you cannot diagnose after the fact
    // is the expensive kind — but it is only served when DEV_TOOLS is on.
    const e = err as { message?: string; status?: number; code?: string; stack?: string };
    const detail = [
      e?.message ?? String(err),
      e?.status ? `status ${e.status}` : null,
      e?.code ? `code ${e.code}` : null,
      e?.stack?.split("\n").slice(1, 4).join("\n") || null,
    ]
      .filter(Boolean)
      .join("\n");
    await db
      .update(schema.jobs)
      .set({
        status: "failed",
        error: "The assistant couldn't finish that. Please try again.",
        errorDetail: detail.slice(0, 4000),
        attempts: (job.attempts ?? 0) + 1,
      })
      .where(eq(schema.jobs.id, id));
    if (process.env.JOBS_INLINE !== "1") throw err;
  }
}
