"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-render the server page on an interval (cheap live view). */
export function Refresh({ every = 3000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [every, router]);
  return null;
}
