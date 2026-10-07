"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";

export function BoardFilters({ users, weeks, user, week }: { users: { id: string; name: string }[]; weeks: { value: string; label: string }[]; user: string; week: string }) {
  const router = useRouter();
  const go = (u: string, w: string) => {
    const q = new URLSearchParams();
    if (u) q.set("user", u);
    if (w) q.set("week", w);
    router.push(`/admin${q.size ? `?${q}` : ""}`);
  };
  return (
    <div className="flex flex-wrap gap-3">
      <Select value={user} onChange={(e) => go(e.target.value, week)} className="w-48" aria-label="Filter by user">
        <option value="">All accounts</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
      <Select value={week} onChange={(e) => go(user, e.target.value)} className="w-48" aria-label="Filter by week">
        <option value="">Next 6 weeks</option>
        {weeks.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
