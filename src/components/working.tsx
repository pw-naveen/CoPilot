"use client";

import type { ReactNode } from "react";
import { Orb } from "./orb";

/**
 * The orb is the app's one "something is happening" signal. Anywhere work is
 * in flight — transcribing, building the persona, writing samples — shows this
 * rather than a spinner or a static card, so waiting always looks the same and
 * always looks alive.
 */
export function Working({
  title,
  children,
  size = 96,
  className,
}: {
  title: string;
  children?: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-5 px-6 py-12 text-center ${className ?? ""}`} role="status" aria-live="polite">
      <span className="relative grid flex-none place-items-center" style={{ width: size, height: size }}>
        <Orb className="absolute inset-0" />
      </span>
      <div className="flex flex-col gap-1.5">
        <p className="text-[16px] font-semibold text-ink">{title}</p>
        {children && <p className="max-w-sm text-[14px] leading-relaxed text-muted">{children}</p>}
      </div>
    </div>
  );
}
