import { PageHeader } from "@/components/ui";
import { ClockControls } from "./clock-controls";

export default function DevClock() {
  return (
    <>
      <PageHeader eyebrow="Time travel" lead="Fast-forward" accent="the scheduler." intro="Moves the clock the scheduler, reminders and deadlines use. Jobs run here immediately, in the web process; the worker also picks up the new time on its next tick." />
      <ClockControls />
    </>
  );
}
