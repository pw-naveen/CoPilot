"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Something went wrong", data);
  return data as T;
}

/** Poll a worker job until it finishes. */
export async function waitForJob<T = any>(jobId: string, { intervalMs = 800, timeoutMs = 120_000 } = {}): Promise<T> {
  const start = Date.now();
  for (;;) {
    const { job } = await api<{ job: { status: string; result: T; error: string | null } }>(`/api/jobs/${jobId}`);
    if (job.status === "done") return job.result;
    if (job.status === "failed") throw new ApiError(500, job.error ?? "The job failed");
    if (Date.now() - start > timeoutMs) throw new ApiError(504, "This is taking longer than expected. Try again in a minute.");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
