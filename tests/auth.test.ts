import { beforeEach, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetDb, seedPeople, call } from "./helpers";
import * as requestRoute from "@/app/api/auth/request/route";
import * as otpRoute from "@/app/api/auth/otp/route";
import * as magicRoute from "@/app/api/auth/magic/route";
import * as usersRoute from "@/app/api/admin/users/route";
import { cookieFor } from "./helpers";
import { NextRequest } from "next/server";

const lastEmail = async (to: string) =>
  (await db.query.emails.findFirst({ where: eq(schema.emails.to, to), orderBy: desc(schema.emails.createdAt) }))!;

describe("login", () => {
  beforeEach(resetDb);

  it("emails a magic link and code, and the code signs in", async () => {
    const { admin } = await seedPeople();
    expect((await call(requestRoute.POST, { body: { email: admin.email } })).status).toBe(200);
    const mail = await lastEmail(admin.email);
    const code = mail.text.match(/code: (\d{6})/)![1];
    const res = await call(otpRoute.POST, { body: { email: admin.email, code } });
    expect(res.status).toBe(200);
    expect(res.json.next).toBe("/admin");
    // code is single-use
    expect((await call(otpRoute.POST, { body: { email: admin.email, code } })).status).toBe(401);
  });

  it("does not reveal unknown emails", async () => {
    const res = await call(requestRoute.POST, { body: { email: "nobody@test.dev" } });
    expect(res.status).toBe(200);
    expect(await db.query.emails.findFirst()).toBeUndefined();
  });

  it("invite → magic link moves the user into onboarding", async () => {
    const { admin } = await seedPeople();
    const cookie = await cookieFor("staff", admin.id);
    const res = await call(usersRoute.POST, {
      cookie,
      body: { name: "Dr Nanda", title: "Director", email: "nanda@test.dev", phone: "+60123456789" },
    });
    expect(res.status).toBe(200);
    const mail = await lastEmail("nanda@test.dev");
    const link = mail.text.match(/(http\S+magic\?token=\S+)/)![1];
    const r = await magicRoute.GET(new NextRequest(link));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("http://localhost:3000/");
    expect(r.headers.get("set-cookie")).toContain("sid=");
    const u = await db.query.users.findFirst({ where: eq(schema.users.email, "nanda@test.dev") });
    expect(u?.status).toBe("onboarding");
    expect(u?.onboardingStep).toBe(2);
  });

  it("rejects bad phone numbers", async () => {
    const { admin } = await seedPeople();
    const res = await call(usersRoute.POST, {
      cookie: await cookieFor("staff", admin.id),
      body: { name: "X", email: "x@test.dev", phone: "0123" },
    });
    expect(res.status).toBe(400);
  });

  it("users cannot invite", async () => {
    const { inScope } = await seedPeople();
    const res = await call(usersRoute.POST, {
      cookie: await cookieFor("user", inScope.id),
      body: { name: "X", email: "x@test.dev", phone: "+60123450000" },
    });
    expect(res.status).toBe(403);
  });
});

describe("staff 2FA", () => {
  beforeEach(resetDb);

  it("enables TOTP and then requires it at sign-in", async () => {
    const { admin } = await seedPeople();
    const totpRoute = await import("@/app/api/me/totp/route");
    const verifyRoute = await import("@/app/api/auth/totp/route");
    const { totpCodeFor } = await import("@/server/auth");
    const cookie = await cookieFor("staff", admin.id);
    const setup = await call(totpRoute.POST, { cookie, method: "POST" });
    expect(setup.json.qr).toMatch(/^data:image\/png/);
    expect((await call(totpRoute.PUT, { cookie, method: "PUT", body: { code: "000000" } })).status).toBe(401);
    expect((await call(totpRoute.PUT, { cookie, method: "PUT", body: { code: totpCodeFor(setup.json.secret) } })).status).toBe(200);

    // A fresh session is held at the 2FA step until the code is given.
    const fresh = await cookieFor("staff", admin.id);
    expect((await call(usersRoute.GET, { cookie: fresh })).status).toBe(401);
    expect((await call(verifyRoute.POST, { cookie: fresh, body: { code: totpCodeFor(setup.json.secret) } })).status).toBe(200);
    expect((await call(usersRoute.GET, { cookie: fresh })).status).toBe(200);
  });
});
