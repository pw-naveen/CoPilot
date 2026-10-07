import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { applyMonthlyCap, approvalDeadline, deferQuietHours, isAtRisk, monthKey, slotTimeline, slotTimes, validateCadence } from "@/server/schedule";

const KL = "Asia/Kuala_Lumpur";
const iso = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toFormat("ccc yyyy-LL-dd HH:mm");

describe("cadence validation", () => {
  it("accepts 2 or 4 a week with matching days and times", () => {
    expect(validateCadence({ postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "12:30"] })).toBeNull();
    expect(validateCadence({ postsPerWeek: 3, weekdays: [1, 2, 3], times: ["09:00", "09:00", "09:00"] })).toMatch(/2 or 4/);
    expect(validateCadence({ postsPerWeek: 2, weekdays: [2], times: ["09:00"] })).toMatch(/Pick 2/);
    expect(validateCadence({ postsPerWeek: 2, weekdays: [2, 2], times: ["09:00", "09:00"] })).toMatch(/different/);
    expect(validateCadence({ postsPerWeek: 2, weekdays: [2, 4], times: ["9am", "09:00"] })).toMatch(/HH:mm/);
  });
});

describe("slot times", () => {
  it("produces local times on the chosen weekdays", () => {
    const from = DateTime.fromISO("2026-10-05T00:00", { zone: KL }).toJSDate(); // Monday
    const until = DateTime.fromISO("2026-10-19T00:00", { zone: KL }).toJSDate();
    const s = slotTimes({ postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "18:30"] }, KL, from, until);
    expect(s.map((d) => iso(d, KL))).toEqual(["Tue 2026-10-06 09:00", "Thu 2026-10-08 18:30", "Tue 2026-10-13 09:00", "Thu 2026-10-15 18:30"]);
  });

  it("keeps the local time across a DST change", () => {
    const NY = "America/New_York"; // DST ends Sun 1 Nov 2026
    const from = DateTime.fromISO("2026-10-26T00:00", { zone: NY }).toJSDate();
    const until = DateTime.fromISO("2026-11-07T00:00", { zone: NY }).toJSDate();
    const s = slotTimes({ postsPerWeek: 2, weekdays: [1, 4], times: ["09:00", "09:00"] }, NY, from, until);
    expect(s.map((d) => iso(d, NY))).toEqual(["Mon 2026-10-26 09:00", "Thu 2026-10-29 09:00", "Mon 2026-11-02 09:00", "Thu 2026-11-05 09:00"]);
  });
});

describe("approval deadline", () => {
  it("is exactly 48 hours before publish, in every time zone", () => {
    for (const tz of [KL, "UTC", "Europe/London", "America/New_York", "Australia/Sydney", "Asia/Kolkata"]) {
      const publish = DateTime.fromISO("2026-11-03T09:00", { zone: tz }).toJSDate();
      expect(publish.getTime() - approvalDeadline(publish).getTime()).toBe(48 * 3600 * 1000);
    }
  });

  it("is 48 real hours even when the clocks change in between", () => {
    const NY = "America/New_York";
    const publish = DateTime.fromISO("2026-11-02T09:00", { zone: NY }).toJSDate(); // day after DST ends
    const d = approvalDeadline(publish);
    expect(publish.getTime() - d.getTime()).toBe(48 * 3600 * 1000);
    // the wall clock shows 10:00 two days earlier because an hour was repeated
    expect(iso(d, NY)).toBe("Sat 2026-10-31 10:00");
  });
});

describe("monthly cap", () => {
  it("drops the last slots of a month over the cap", () => {
    const tz = KL;
    const days = Array.from({ length: 25 }, (_, i) => DateTime.fromISO("2026-12-01T09:00", { zone: tz }).plus({ days: i }).toJSDate());
    const kept = applyMonthlyCap(days, new Map(), 20, tz);
    expect(kept).toHaveLength(20);
    expect(iso(kept[kept.length - 1], tz)).toBe("Sun 2026-12-20 09:00");
  });

  it("counts slots that already exist, extras included", () => {
    const tz = KL;
    const days = Array.from({ length: 5 }, (_, i) => DateTime.fromISO("2026-12-01T09:00", { zone: tz }).plus({ days: i }).toJSDate());
    expect(applyMonthlyCap(days, new Map([["2026-12", 18]]), 20, tz)).toHaveLength(2);
  });

  it("uses the user's month, not UTC's", () => {
    const d = DateTime.fromISO("2026-12-01T06:00", { zone: KL }).toJSDate(); // still 30 Nov in UTC
    expect(monthKey(d, KL)).toBe("2026-12");
    expect(monthKey(d, "UTC")).toBe("2026-11");
  });
});

describe("timeline", () => {
  it("works backwards from publish time", () => {
    const publish = DateTime.fromISO("2026-10-15T09:00", { zone: KL }).toJSDate();
    const t = slotTimeline(publish, KL);
    expect(iso(t.topicPromptAt, KL)).toBe("Thu 2026-10-08 09:00");
    expect(iso(t.autoDraftAt, KL)).toBe("Sat 2026-10-10 09:00");
    expect(iso(t.reminder1At, KL)).toBe("Mon 2026-10-12 09:00");
    expect(iso(t.reminder2At, KL)).toBe("Tue 2026-10-13 08:00"); // 01:00 is quiet → next 8am
    expect(iso(t.deadline, KL)).toBe("Tue 2026-10-13 09:00");
  });

  it("defers quiet-hour reminders to the next 8am", () => {
    expect(iso(deferQuietHours(DateTime.fromISO("2026-10-12T23:30", { zone: KL }).toJSDate(), KL), KL)).toBe("Tue 2026-10-13 08:00");
    expect(iso(deferQuietHours(DateTime.fromISO("2026-10-12T05:00", { zone: KL }).toJSDate(), KL), KL)).toBe("Mon 2026-10-12 08:00");
    expect(iso(deferQuietHours(DateTime.fromISO("2026-10-12T21:59", { zone: KL }).toJSDate(), KL), KL)).toBe("Mon 2026-10-12 21:59");
  });

  it("flags slots inside 72 hours without approval", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const soon = new Date(now.getTime() + 60 * 3600_000);
    expect(isAtRisk({ publishAt: soon, status: "pending_approval" }, now)).toBe(true);
    expect(isAtRisk({ publishAt: soon, status: "approved" }, now)).toBe(false);
    expect(isAtRisk({ publishAt: new Date(now.getTime() + 80 * 3600_000), status: "drafting" }, now)).toBe(false);
  });
});
