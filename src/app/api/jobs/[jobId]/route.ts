import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { route } from "@/server/http";
import { isUuid, loadScoped, requireAdmin } from "@/server/scope";
import { notFound } from "@/server/errors";

export const GET = route<{ jobId: string }>(async ({ actor, params }) => {
  if (!isUuid(params.jobId)) throw notFound();
  const row = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, params.jobId) });
  if (row && !row.userId) requireAdmin(actor); // system jobs (WhatsApp checks) are admin-only
  const job = row && !row.userId ? row : await loadScoped(actor, async () => row);
  return { job: { id: job.id, kind: job.kind, status: job.status, result: job.result, error: job.error } };
});
