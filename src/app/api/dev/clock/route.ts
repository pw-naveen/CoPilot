import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { devToolsEnabled, getOffsetMs, now, setOffsetMs } from "@/server/clock";
import { cronJobs, runCron } from "@/server/cron";

/** Dev-only time travel: move the scheduler clock and run cron jobs on demand. */
export async function GET() {
  if (!devToolsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ now: await now(), offsetMs: await getOffsetMs(), jobs: Object.keys(cronJobs) });
}

const input = z.object({
  addMs: z.number().optional(),
  reset: z.boolean().optional(),
  run: z.string().optional(),
});

export async function POST(req: NextRequest) {
  if (!devToolsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const p = input.parse(await req.json());
  if (p.reset) await setOffsetMs(0);
  if (p.addMs) await setOffsetMs((await getOffsetMs()) + p.addMs);
  const result = p.run ? await runCron(p.run) : undefined;
  return NextResponse.json({ now: await now(), offsetMs: await getOffsetMs(), result });
}
