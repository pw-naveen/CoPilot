"use client";

import { Orb } from "./orb";

/**
 * The orb as room light: oversized, well behind the content, with a scrim that
 * keeps text contrast intact. Shared by the auth screens and the setup flow so
 * the whole journey reads as one surface rather than separate pages.
 */
export function AmbientOrb({ level = 0 }: { level?: number }) {
  return (
    <>
      <Orb
        level={level}
        className="pointer-events-none absolute top-1/2 left-1/2 h-[min(170vw,150vh)] w-[min(170vw,150vh)] -translate-x-1/2 -translate-y-1/2 opacity-40"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 78% 58% at 50% 50%, rgba(11,11,12,0.70) 0%, rgba(11,11,12,0.92) 56%, var(--bg) 86%)",
        }}
      />
    </>
  );
}
