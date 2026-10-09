/**
 * Role scope on every API route.
 *
 * Each exported handler in src/app/api/** must appear in SPECS below (the coverage test
 * fails otherwise). For user-scoped routes we call the handler as a sub-admin against an
 * account outside their scope and expect 403/404, then against an in-scope account and
 * expect anything but 403/404. Users are checked the same way against someone else's data.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { resetDb, seedPeople, cookieFor, call } from "./helpers";
import { makeFixtures, type Fixtures } from "./fixtures";

type Who = "admin" | "sub" | "user";
type Target = "in" | "out";
type Spec = {
  route: string; // path under src/app/api, e.g. "admin/users/[userId]"
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** public: no session; global: staff-wide (admin-only checks below); scoped: per account */
  kind: "public" | "admin-only" | "staff-any" | "scoped" | "self";
  params?: (f: Fixtures, t: Target) => Record<string, string>;
  body?: (f: Fixtures, t: Target) => unknown;
  query?: (f: Fixtures, t: Target) => string;
  /** for scoped routes: which roles may use the route at all (default staff + user) */
  roles?: Who[];
};

export const SPECS: Spec[] = [
  // auth (public by design)
  { route: "auth/request", method: "POST", kind: "public" },
  { route: "auth/magic", method: "GET", kind: "public" },
  { route: "auth/otp", method: "POST", kind: "public" },
  { route: "auth/totp", method: "POST", kind: "public" },
  { route: "auth/logout", method: "POST", kind: "public" },
  { route: "auth/register", method: "POST", kind: "public" },
  { route: "auth/login", method: "POST", kind: "public" },
  { route: "auth/whatsapp", method: "POST", kind: "public" },
  // self-service, act only on the caller
  { route: "me/totp", method: "POST", kind: "self", roles: ["admin", "sub"] },
  { route: "me/totp", method: "PUT", kind: "self", roles: ["admin", "sub"] },
  { route: "me/totp", method: "DELETE", kind: "self", roles: ["admin", "sub"] },
  // admin only
  { route: "admin/staff", method: "GET", kind: "admin-only" },
  { route: "admin/staff", method: "POST", kind: "admin-only", body: () => ({ name: "S", email: "s2@test.dev" }) },
  { route: "admin/staff/[staffId]", method: "PATCH", kind: "admin-only", params: (f) => ({ staffId: f.subId }), body: () => ({ canInvite: true }) },
  { route: "admin/staff/[staffId]/accounts", method: "PUT", kind: "admin-only", params: (f) => ({ staffId: f.subId }), body: (f) => ({ userIds: [f.user("in").id] }) },
  { route: "users/[userId]/approval", method: "POST", kind: "admin-only", params: (f, t) => ({ userId: f.user(t).id }), body: () => ({ decision: "approve" }) },
  { route: "admin/settings", method: "GET", kind: "admin-only" },
  { route: "admin/settings", method: "PUT", kind: "admin-only", body: () => ({ "limits.monthly_cap": "20" }) },
  // staff, results filtered to scope (checked in the list tests below)
  { route: "admin/users", method: "GET", kind: "staff-any" },
  { route: "admin/users", method: "POST", kind: "staff-any", body: (f) => ({ name: "New", email: `n${Date.now()}@test.dev`, phone: `+6019${Date.now() % 10_000_000}` }) },
  // per-account
  { route: "admin/users/[userId]", method: "GET", kind: "scoped", roles: ["admin", "sub"], params: (f, t) => ({ userId: f.user(t).id }) },
  { route: "admin/users/[userId]", method: "PATCH", kind: "scoped", roles: ["admin", "sub"], params: (f, t) => ({ userId: f.user(t).id }), body: () => ({ staffApprovalIsFinal: false }) },
  { route: "admin/users/[userId]/reinvite", method: "POST", kind: "scoped", roles: ["admin", "sub"], params: (f, t) => ({ userId: f.user(t).id }) },
  { route: "admin/audit", method: "GET", kind: "scoped", roles: ["admin", "sub"], query: (f, t) => `?userId=${f.user(t).id}` },
  // per-account setup (user acts on themselves; staff on their scope)
  { route: "files/[...key]", method: "GET", kind: "public" }, // HMAC-signed URLs only
  { route: "users/[userId]/onboarding", method: "GET", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }) },
  { route: "users/[userId]/onboarding/step", method: "POST", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }), body: () => ({ step: 2 }) },
  { route: "users/[userId]/profile", method: "PUT", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }), body: (f, t) => ({ name: f.user(t).name, displayName: f.user(t).displayName, languages: ["en"], timezone: "Asia/Kuala_Lumpur" }) },
  { route: "users/[userId]/answers/[key]", method: "PUT", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id, key: "career_story" }), body: () => ({ text: "Twenty years in cardiology." }) },
  { route: "users/[userId]/answers/[key]/audio", method: "POST", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id, key: "career_story" }), body: () => undefined },
  { route: "users/[userId]/answers/[key]/audio", method: "DELETE", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id, key: "career_story" }) },
  { route: "users/[userId]/answers/[key]/audio", method: "PUT", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id, key: "career_story" }) },
  { route: "users/[userId]/answers", method: "GET", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }) },
  { route: "users/[userId]/samples", method: "POST", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }), body: () => ({ text: "A sample long enough to be accepted by the sample validator, honestly." }) },
  { route: "users/[userId]/samples/[sampleId]", method: "DELETE", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id, sampleId: f.sample(t) }) },
  { route: "users/[userId]/persona", method: "GET", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }) },
  { route: "users/[userId]/persona", method: "PUT", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }), body: (f) => ({ json: f.personaJson }) },
  { route: "users/[userId]/persona/generate", method: "POST", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }), body: () => ({ note: "" }) },
  { route: "users/[userId]/persona/restore", method: "POST", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }), body: () => ({ version: 1 }) },
  { route: "users/[userId]/tone", method: "GET", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }) },
  { route: "users/[userId]/tone", method: "POST", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }) },
  { route: "users/[userId]/tone/[sampleId]", method: "POST", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id, sampleId: f.toneSample(t) }), body: () => ({ verdict: "close", comment: "less corporate" }) },
  { route: "jobs/[jobId]", method: "GET", kind: "scoped", params: (f, t) => ({ jobId: f.job(t) }) },
  // cadence & calendar
  { route: "users/[userId]/cadence", method: "GET", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }) },
  { route: "users/[userId]/cadence", method: "PUT", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }), body: () => ({ postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] }) },
  { route: "users/[userId]/cadence/preview", method: "POST", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }), body: () => ({ postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] }) },
  { route: "users/[userId]/slots", method: "GET", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }) },
  { route: "slots/[slotId]/skip", method: "POST", kind: "scoped", params: (f, t) => ({ slotId: f.slot(t) }) },
  // WhatsApp
  { route: "users/[userId]/whatsapp", method: "GET", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }) },
  { route: "users/[userId]/whatsapp/verify", method: "POST", kind: "scoped", params: (f, t) => ({ userId: f.user(t).id }), body: () => ({}) },
  { route: "admin/whatsapp", method: "GET", kind: "admin-only" },
  { route: "admin/whatsapp", method: "POST", kind: "admin-only", body: () => ({ action: "check" }) },
  { route: "webhooks/evolution", method: "POST", kind: "public" }, // shared-secret check, tested in whatsapp.test.ts
  // posts
  { route: "posts/[postId]", method: "GET", kind: "scoped", params: (f, t) => ({ postId: f.post(t) }) },
  { route: "posts/[postId]", method: "POST", kind: "scoped", params: (f, t) => ({ postId: f.post(t) }), body: () => ({ action: "edit", text: "Edited by scope test." }) },
  { route: "posts/[postId]/audio", method: "POST", kind: "scoped", params: (f, t) => ({ postId: f.post(t) }), body: () => undefined },
  { route: "preview/[token]", method: "GET", kind: "public" }, // token-scoped, tested in drafts.test.ts
  { route: "preview/[token]", method: "POST", kind: "public" },
  { route: "preview/[token]/audio", method: "POST", kind: "public" },
  { route: "admin/board", method: "GET", kind: "scoped", roles: ["admin", "sub"], query: (f, t) => `?userId=${f.user(t).id}` },
  { route: "dev/clock", method: "GET", kind: "public" }, // DEV_TOOLS only
  { route: "dev/clock", method: "POST", kind: "public" }, // DEV_TOOLS only
];

const API_DIR = join(process.cwd(), "src/app/api");

function routeFiles(dir = API_DIR): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return n === "route.ts" ? [relative(API_DIR, dir)] : [];
  });
}

const load = (route: string) => import(/* @vite-ignore */ join(API_DIR, route, "route.ts"));

let f: Fixtures;
let cookies: Record<Who, string>;
let otherUserCookie: string;

beforeAll(async () => {
  await resetDb();
  const people = await seedPeople();
  f = await makeFixtures(people);
  cookies = {
    admin: await cookieFor("staff", people.admin.id),
    sub: await cookieFor("staff", people.sub.id),
    user: await cookieFor("user", people.inScope.id), // "in" for a user means their own account
  };
  otherUserCookie = await cookieFor("user", people.outScope.id);
});

describe("route coverage", () => {
  it("every exported handler has a scope spec", async () => {
    const missing: string[] = [];
    for (const r of routeFiles()) {
      const mod = await load(r);
      for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"])
        if (mod[m] && !SPECS.some((s) => s.route === r && s.method === m)) missing.push(`${m} ${r}`);
    }
    expect(missing).toEqual([]);
  });
});

const run = async (s: Spec, who: Who | "none" | "otherUser", t: Target) => {
  const mod = await load(s.route);
  const cookie = who === "none" ? undefined : who === "otherUser" ? otherUserCookie : cookies[who];
  return call(mod[s.method], {
    method: s.method,
    cookie,
    params: s.params?.(f, t),
    body: s.body?.(f, t) ?? (s.method === "GET" || s.method === "DELETE" ? undefined : {}),
    path: `/api/${s.route}${s.query?.(f, t) ?? ""}`,
  });
};

const DENIED = [401, 403, 404];

describe("scope", () => {
  for (const s of SPECS.filter((s) => s.kind !== "public")) {
    describe(`${s.method} ${s.route}`, () => {
      it("requires a session", async () => {
        expect((await run(s, "none", "in")).status).toBe(401);
      });

      if (s.kind === "admin-only") {
        it("rejects sub-admins and users", async () => {
          expect((await run(s, "sub", "in")).status).toBe(403);
          expect((await run(s, "user", "in")).status).toBe(403);
        });
        it("allows admins", async () => {
          expect(DENIED).not.toContain((await run(s, "admin", "in")).status);
        });
      }

      if (s.kind === "scoped") {
        const roles = s.roles ?? ["admin", "sub", "user"];
        it("denies a sub-admin outside their scope", async () => {
          expect(DENIED).toContain((await run(s, "sub", "out")).status);
        });
        if (roles.includes("sub"))
          it("allows a sub-admin inside their scope", async () => {
            expect(DENIED).not.toContain((await run(s, "sub", "in")).status);
          });
        it("allows admins on any account", async () => {
          expect(DENIED).not.toContain((await run(s, "admin", "out")).status);
        });
        if (roles.includes("user")) {
          it("allows a user on their own account", async () => {
            expect(DENIED).not.toContain((await run(s, "user", "in")).status);
          });
          it("denies a user on someone else's account", async () => {
            expect(DENIED).toContain((await run(s, "user", "out")).status);
          });
        } else {
          it("denies users", async () => {
            expect(DENIED).toContain((await run(s, "user", "in")).status);
          });
        }
      }

      if (s.kind === "self" && !(s.roles ?? []).includes("user"))
        it("denies users", async () => {
          expect((await run(s, "user", "in")).status).toBe(403);
        });
    });
  }
});

describe("preview tokens", () => {
  it("only open their own post", async () => {
    const { createPreviewLink } = await import("@/server/services/posts");
    const token = (await createPreviewLink(f.post("in"))).split("/p/")[1];
    const mod = await load("preview/[token]");
    const r = await call(mod.GET, { params: { token } });
    expect(r.json.post.id).toBe(f.post("in"));
    expect((await call(mod.GET, { params: { token: "not-a-token" } })).status).toBe(404);
  });
});

describe("dev tools", () => {
  it("are unreachable when DEV_TOOLS is off", async () => {
    process.env.DEV_TOOLS = "0";
    try {
      for (const r of ["dev/clock"]) {
        const mod = await load(r);
        expect((await call(mod.GET, { path: `/api/${r}?phone=%2B1` })).status).toBe(404);
        expect((await call(mod.POST, { body: { from: "+1", text: "x" } })).status).toBe(404);
      }
    } finally {
      process.env.DEV_TOOLS = "1";
    }
  });
});

describe("lists are filtered to scope", () => {
  it("sub-admin sees only assigned accounts", async () => {
    const mod = await load("admin/users");
    const { json } = await call(mod.GET, { cookie: cookies.sub });
    const ids = json.users.map((u: { id: string }) => u.id);
    expect(ids).toContain(f.user("in").id);
    expect(ids).not.toContain(f.user("out").id);
  });

  it("sub-admin audit log excludes other accounts", async () => {
    const mod = await load("admin/audit");
    const { json } = await call(mod.GET, { cookie: cookies.sub, path: "/api/admin/audit" });
    for (const e of json.entries) expect(e.userId).toBe(f.user("in").id);
  });

  it("a sub-admin's invitee is placed in their scope", async () => {
    const mod = await load("admin/users");
    const { json } = await call(mod.POST, {
      cookie: cookies.sub,
      body: { name: "Scoped", email: "scoped@test.dev", phone: "+60199999999" },
    });
    const list = await call(mod.GET, { cookie: cookies.sub });
    expect(list.json.users.map((u: { id: string }) => u.id)).toContain(json.user.id);
  });
});
