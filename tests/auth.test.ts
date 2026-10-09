import { beforeEach, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetDb, seedPeople, call } from "./helpers";
import * as requestRoute from "@/app/api/auth/request/route";
import * as otpRoute from "@/app/api/auth/otp/route";
import * as magicRoute from "@/app/api/auth/magic/route";
import * as usersRoute from "@/app/api/admin/users/route";
import * as registerRoute from "@/app/api/auth/register/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as waRoute from "@/app/api/auth/whatsapp/route";
import * as approvalRoute from "@/app/api/users/[userId]/approval/route";
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

describe("registration and approval", () => {
  beforeEach(resetDb);

  const NEW = { name: "Dr New", email: "new@test.dev", password: "a-long-enough-password", company: "Mediwira", phone: "+60127000111" };

  it("creates a pending account that cannot sign in until an admin approves it", async () => {
    await seedPeople();
    expect((await call(registerRoute.POST, { body: NEW })).status).toBe(200);

    const u = await db.query.users.findFirst({ where: eq(schema.users.email, NEW.email) });
    expect(u?.status).toBe("pending");
    expect(u?.org).toBe("Mediwira");
    expect(u?.phoneE164).toBe("+60127000111");
    expect(u?.passwordHash).toBeTruthy();
    expect(u?.passwordHash).not.toContain(NEW.password); // stored hashed, never in the clear

    // Correct password, but the account is not approved yet.
    const blocked = await call(loginRoute.POST, { body: { email: NEW.email, password: NEW.password } });
    expect(blocked.status).toBe(403);

    const admin = await db.query.staff.findFirst({ where: eq(schema.staff.role, "admin") });
    const approved = await call(approvalRoute.POST, {
      cookie: await cookieFor("staff", admin!.id),
      params: { userId: u!.id },
      body: { decision: "approve" },
    });
    expect(approved.status).toBe(200);

    const ok = await call(loginRoute.POST, { body: { email: NEW.email, password: NEW.password } });
    expect(ok.status).toBe(200);
    const after = await db.query.users.findFirst({ where: eq(schema.users.id, u!.id) });
    expect(after?.status).toBe("onboarding");
    expect(after?.approvedBy).toBe(admin!.id);
  });

  it("rejects a wrong password with the same message as an unknown email", async () => {
    await seedPeople();
    await call(registerRoute.POST, { body: NEW });
    const u = await db.query.users.findFirst({ where: eq(schema.users.email, NEW.email) });
    const admin = await db.query.staff.findFirst({ where: eq(schema.staff.role, "admin") });
    await call(approvalRoute.POST, { cookie: await cookieFor("staff", admin!.id), params: { userId: u!.id }, body: { decision: "approve" } });

    const wrong = await call(loginRoute.POST, { body: { email: NEW.email, password: "not-the-password" } });
    const unknown = await call(loginRoute.POST, { body: { email: "nobody@test.dev", password: "not-the-password" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.error).toBe(unknown.json.error);
  });

  it("refuses a duplicate email or WhatsApp number", async () => {
    await seedPeople();
    await call(registerRoute.POST, { body: NEW });
    expect((await call(registerRoute.POST, { body: NEW })).status).toBe(409);
    expect((await call(registerRoute.POST, { body: { ...NEW, email: "other@test.dev" } })).status).toBe(409); // same phone
    expect((await call(registerRoute.POST, { body: { ...NEW, email: "other@test.dev", phone: "+60127000222" } })).status).toBe(200);
  });

  it("stops password guessing after repeated wrong attempts", async () => {
    await seedPeople();
    await call(registerRoute.POST, { body: NEW });
    const u = await db.query.users.findFirst({ where: eq(schema.users.email, NEW.email) });
    const admin = await db.query.staff.findFirst({ where: eq(schema.staff.role, "admin") });
    await call(approvalRoute.POST, { cookie: await cookieFor("staff", admin!.id), params: { userId: u!.id }, body: { decision: "approve" } });

    const codes: number[] = [];
    for (let i = 0; i < 12; i++)
      codes.push((await call(loginRoute.POST, { body: { email: NEW.email, password: `wrong-${i}` } })).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    // The correct password is refused too once the window is tripped.
    expect((await call(loginRoute.POST, { body: { email: NEW.email, password: NEW.password } })).status).toBe(429);
  });

  it("will not let a sign-up shadow a staff email", async () => {
    const { admin } = await seedPeople();
    expect((await call(registerRoute.POST, { body: { ...NEW, email: admin.email } })).status).toBe(409);
  });

  it("keeps a rejected account out", async () => {
    await seedPeople();
    await call(registerRoute.POST, { body: NEW });
    const u = await db.query.users.findFirst({ where: eq(schema.users.email, NEW.email) });
    const admin = await db.query.staff.findFirst({ where: eq(schema.staff.role, "admin") });
    await call(approvalRoute.POST, {
      cookie: await cookieFor("staff", admin!.id),
      params: { userId: u!.id },
      body: { decision: "reject", reason: "Not a client" },
    });
    expect((await call(loginRoute.POST, { body: { email: NEW.email, password: NEW.password } })).status).toBe(403);
    const after = await db.query.users.findFirst({ where: eq(schema.users.id, u!.id) });
    expect(after?.status).toBe("rejected");
    expect(after?.rejectedReason).toBe("Not a client");
  });
});

describe("WhatsApp verification at sign-up", () => {
  beforeEach(resetDb);

  const NEW2 = { name: "Dr Wa", email: "wa@test.dev", password: "a-long-enough-password", company: "Mediwira", phone: "+60127000999" };
  const codeFor = async (email: string) => {
    const u = (await db.query.users.findFirst({ where: eq(schema.users.email, email) }))!;
    const msg = await db.query.waMessages.findFirst({
      where: eq(schema.waMessages.userId, u.id),
      orderBy: desc(schema.waMessages.createdAt),
    });
    return msg!.body!.match(/(\d{6})/)![1];
  };

  it("sends a code on sign-up and confirms the number", async () => {
    await seedPeople();
    expect((await call(registerRoute.POST, { body: NEW2 })).status).toBe(200);

    const u = (await db.query.users.findFirst({ where: eq(schema.users.email, NEW2.email) }))!;
    expect(u.whatsappVerifiedAt).toBeNull();
    const code = await codeFor(NEW2.email);
    expect(code).toMatch(/^\d{6}$/);

    const ok = await call(waRoute.POST, { body: { email: NEW2.email, code } });
    expect(ok.status).toBe(200);
    const after = (await db.query.users.findFirst({ where: eq(schema.users.id, u.id) }))!;
    expect(after.whatsappVerifiedAt).toBeTruthy();
    // Verifying the number does not approve the account.
    expect(after.status).toBe("pending");
  });

  it("rejects a wrong code and does not verify", async () => {
    await seedPeople();
    await call(registerRoute.POST, { body: NEW2 });
    expect((await call(waRoute.POST, { body: { email: NEW2.email, code: "000000" } })).status).toBe(401);
    const u = (await db.query.users.findFirst({ where: eq(schema.users.email, NEW2.email) }))!;
    expect(u.whatsappVerifiedAt).toBeNull();
  });

  it("a code is single use", async () => {
    await seedPeople();
    await call(registerRoute.POST, { body: NEW2 });
    const code = await codeFor(NEW2.email);
    expect((await call(waRoute.POST, { body: { email: NEW2.email, code } })).status).toBe(200);
    // Second attempt finds the account already verified rather than re-consuming.
    const again = await call(waRoute.POST, { body: { email: NEW2.email, code } });
    expect(again.json.alreadyVerified).toBe(true);
  });

  it("setup cannot be completed while the number is unverified", async () => {
    const { inScope } = await seedPeople();
    const { completeStep } = await import("@/server/services/onboarding");
    const { saveCadence } = await import("@/server/services/cadence");
    const { SYSTEM } = await import("@/server/actor");
    await db.update(schema.users).set({ onboardingStep: 6, whatsappVerifiedAt: null }).where(eq(schema.users.id, inScope.id));
    await saveCadence(SYSTEM, inScope.id, { postsPerWeek: 2, weekdays: [2, 4], times: ["09:00", "09:00"] });
    await expect(completeStep(SYSTEM, inScope.id, 6)).rejects.toThrow();
  });
});
