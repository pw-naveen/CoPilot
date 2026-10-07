import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { route } from "@/server/http";
import { isUuid, loadScoped } from "@/server/scope";
import { notFound } from "@/server/errors";

export const GET = route<{ jobId: string }>(async ({ actor, params }) => {
  if (!isUuid(params.jobId)) throw notFound();
  const job = await loadScoped(actor, () => db.query.jobs.findFirst({ where: eq(schema.jobs.id, params.jobId) }));
  return { job: { id: job.id, kind: job.kind, status: job.status, result: job.result, error: job.error } };
});
