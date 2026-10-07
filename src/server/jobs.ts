import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { addJob } from "./queue";

/**
 * On-demand work the web app hands to the worker (AI calls, transcription). The
 * browser polls the `jobs` row. With JOBS_INLINE=1 (tests) the job runs in-process.
 */
export type JobKind = "transcribe_answer" | "persona_generate" | "tone_generate" | "tone_feedback";

export async function enqueue(kind: JobKind, userId: string, input: Record<string, unknown>) {
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
    const result = await handlers[job.kind as JobKind](job.userId!, (job.input ?? {}) as Record<string, unknown>);
    await db.update(schema.jobs).set({ status: "done", result: result ?? null }).where(eq(schema.jobs.id, id));
  } catch (err) {
    console.error(`[job ${job.kind}]`, err);
    await db.update(schema.jobs).set({ status: "failed", error: "The assistant couldn't finish that. Please try again." }).where(eq(schema.jobs.id, id));
    if (process.env.JOBS_INLINE !== "1") throw err;
  }
}
