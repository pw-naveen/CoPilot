import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import * as OTPAuth from "otpauth";
import { db, schema } from "@/db";
import type { Actor } from "./actor";
import { decrypt, encrypt, hashPassword, randomDigits, randomToken, sha256, verifyPassword } from "./crypto";
import { sendEmail } from "./email";
import { appBaseUrl } from "./config";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "./errors";
import type { AnyActor } from "./actor";
import { toE164 } from "./whatsapp/gateway";

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;
const LOGIN_MINUTES = 15;
const INVITE_DAYS = 7;
const MAX_OTP_ATTEMPTS = 5;

type Principal = { type: "staff" | "user"; id: string; email: string; name: string };

async function findByEmail(email: string): Promise<Principal | null> {
  const e = email.trim().toLowerCase();
  const s = await db.query.staff.findFirst({ where: eq(schema.staff.email, e) });
  if (s) return { type: "staff", id: s.id, email: s.email, name: s.name };
  const u = await db.query.users.findFirst({ where: eq(schema.users.email, e) });
  if (u && u.status !== "paused") return { type: "user", id: u.id, email: u.email, name: u.displayName };
  return null;
}

async function issueLoginToken(p: Principal, minutes: number) {
  const token = randomToken();
  const otp = randomDigits(6);
  await db.insert(schema.loginTokens).values({
    actorType: p.type,
    actorId: p.id,
    tokenHash: sha256(token),
    otpHash: sha256(`${p.id}:${otp}`),
    expiresAt: new Date(Date.now() + minutes * 60_000),
  });
  return { link: `${appBaseUrl()}/api/auth/magic?token=${token}`, otp };
}

/** Sends a magic link plus a 6-digit code. Silent when the email is unknown. */
export async function requestLogin(email: string) {
  const p = await findByEmail(email);
  if (!p) return;
  const { link, otp } = await issueLoginToken(p, LOGIN_MINUTES);
  await sendEmail(
    p.email,
    "Your sign-in link",
    `Hi ${p.name},\n\nSign in with this link (valid for ${LOGIN_MINUTES} minutes):\n${link}\n\nOr enter this code: ${otp}\n\nIf you did not ask for this, ignore this email.`,
  );
}

export async function sendInvite(p: Principal, invitedBy: string) {
  const { link } = await issueLoginToken(p, INVITE_DAYS * 24 * 60);
  await sendEmail(
    p.email,
    "You're invited",
    `Hi ${p.name},\n\n${invitedBy} has set up an account for you. Open this link to get started (valid for ${INVITE_DAYS} days):\n${link}\n\nAfter that, sign in any time with your email; we'll send you a link or a code.`,
  );
}

async function consume(row: typeof schema.loginTokens.$inferSelect) {
  const res = await db
    .update(schema.loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.loginTokens.id, row.id), isNull(schema.loginTokens.usedAt)))
    .returning();
  if (!res.length) throw unauthorized("This link has already been used");
  return createSession(row.actorType as "staff" | "user", row.actorId);
}

export async function verifyMagicLink(token: string) {
  const row = await db.query.loginTokens.findFirst({
    where: and(
      eq(schema.loginTokens.tokenHash, sha256(token)),
      isNull(schema.loginTokens.usedAt),
      gt(schema.loginTokens.expiresAt, new Date()),
    ),
  });
  if (!row) throw unauthorized("This link is invalid or has expired");
  return consume(row);
}

export async function verifyOtp(email: string, code: string) {
  const p = await findByEmail(email);
  if (!p) throw unauthorized("Invalid code");
  const rows = await db.query.loginTokens.findMany({
    where: and(
      eq(schema.loginTokens.actorId, p.id),
      isNull(schema.loginTokens.usedAt),
      gt(schema.loginTokens.expiresAt, new Date()),
    ),
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: 3,
  });
  const hash = sha256(`${p.id}:${code.trim()}`);
  const match = rows.find((r) => r.otpHash === hash && r.attempts < MAX_OTP_ATTEMPTS);
  if (!match) {
    for (const r of rows)
      await db.update(schema.loginTokens).set({ attempts: r.attempts + 1 }).where(eq(schema.loginTokens.id, r.id));
    throw unauthorized("Invalid code");
  }
  return consume(match);
}

export async function createSession(type: "staff" | "user", id: string) {
  const raw = randomToken();
  let needsTotp = false;
  if (type === "staff") {
    const s = await db.query.staff.findFirst({ where: eq(schema.staff.id, id) });
    needsTotp = !!s?.totpSecret;
  } else {
    // First login moves an invited user into onboarding.
    await db
      .update(schema.users)
      .set({ status: "onboarding", onboardingStep: 2 })
      .where(and(eq(schema.users.id, id), eq(schema.users.status, "invited")));
  }
  await db.insert(schema.sessions).values({
    id: sha256(raw),
    actorType: type,
    actorId: id,
    needsTotp,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
  });
  return { cookie: raw, needsTotp, type };
}

export async function destroySession(raw: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(raw)));
}

export type SessionState = { actor: Actor; needsTotp: boolean; sessionId: string };

export async function resolveSession(raw: string | undefined | null): Promise<SessionState | null> {
  if (!raw) return null;
  const s = await db.query.sessions.findFirst({
    where: and(eq(schema.sessions.id, sha256(raw)), gt(schema.sessions.expiresAt, new Date())),
  });
  if (!s) return null;
  if (s.actorType === "staff") {
    const st = await db.query.staff.findFirst({ where: eq(schema.staff.id, s.actorId) });
    if (!st) return null;
    return {
      sessionId: s.id,
      needsTotp: s.needsTotp,
      actor: { type: "staff", id: st.id, role: st.role, name: st.name, email: st.email, canInvite: st.canInvite },
    };
  }
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, s.actorId) });
  if (!u || u.status === "paused") return null;
  return {
    sessionId: s.id,
    needsTotp: false,
    actor: { type: "user", id: u.id, name: u.displayName, email: u.email },
  };
}

// ── TOTP for staff ────────────────────────────────────────────────────────

function totp(secret: string, label: string) {
  return new OTPAuth.TOTP({
    issuer: "CoPilot",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export async function beginTotpSetup(staffId: string) {
  const st = await db.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
  if (!st) throw unauthorized();
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  await db.update(schema.staff).set({ totpPending: encrypt(secret) }).where(eq(schema.staff.id, staffId));
  return { secret, uri: totp(secret, st.email).toString() };
}

export async function confirmTotpSetup(staffId: string, code: string) {
  const st = await db.query.staff.findFirst({ where: eq(schema.staff.id, staffId) });
  if (!st?.totpPending) throw unauthorized("No 2FA setup in progress");
  const secret = decrypt(st.totpPending);
  if (totp(secret, st.email).validate({ token: code.trim(), window: 1 }) === null) throw unauthorized("Invalid code");
  await db
    .update(schema.staff)
    .set({ totpSecret: st.totpPending, totpPending: null })
    .where(eq(schema.staff.id, staffId));
}

export async function disableTotp(staffId: string) {
  await db.update(schema.staff).set({ totpSecret: null, totpPending: null }).where(eq(schema.staff.id, staffId));
}

export async function verifySessionTotp(rawCookie: string, code: string) {
  const s = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, sha256(rawCookie)) });
  if (!s || s.actorType !== "staff") throw unauthorized();
  const st = await db.query.staff.findFirst({ where: eq(schema.staff.id, s.actorId) });
  if (!st?.totpSecret) throw unauthorized();
  if (totp(decrypt(st.totpSecret), st.email).validate({ token: code.trim(), window: 1 }) === null)
    throw unauthorized("Invalid code");
  await db.update(schema.sessions).set({ needsTotp: false }).where(eq(schema.sessions.id, s.id));
}

/** Test helper: generate the current TOTP code for a secret. */
export const totpCodeFor = (secret: string) => totp(secret, "x").generate();

// ── Registration and password sign-in ─────────────────────────────────────

/**
 * Self-service sign-up. The account is created in `pending` and cannot sign in
 * until an admin approves it, so this endpoint never hands back a session.
 */
export const registerInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10).max(200),
  company: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(30),
});

export async function registerUser(input: z.infer<typeof registerInput>) {
  const email = input.email.trim().toLowerCase();
  const phone = toE164(input.phone);
  if (phone.replace(/\D/g, "").length < 8) throw badRequest("Enter your WhatsApp number in international format, e.g. +60123456789");

  // Staff emails are managed separately and must never be shadowed by a sign-up.
  if (await db.query.staff.findFirst({ where: eq(schema.staff.email, email) }))
    throw conflict("That email is already registered");
  if (await db.query.users.findFirst({ where: eq(schema.users.email, email) }))
    throw conflict("That email is already registered");
  if (await db.query.users.findFirst({ where: eq(schema.users.phoneE164, phone) }))
    throw conflict("That WhatsApp number is already registered");

  const [u] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: hashPassword(input.password),
      name: input.name,
      displayName: input.name,
      org: input.company,
      phoneE164: phone,
      status: "pending",
      onboardingStep: 1,
    })
    .returning();

  // Send the WhatsApp code immediately: the number is verified before an admin
  // ever sees the request, so nobody approves an account that cannot be reached.
  await sendWhatsappCode(u.id).catch(() => {});

  // Tell the admins there is something to action; failure here must not lose the signup.
  const admins = await db.query.staff.findMany({ where: eq(schema.staff.role, "admin") });
  await Promise.all(
    admins.map((a) =>
      sendEmail(
        a.email,
        "New registration awaiting approval",
        `${input.name} (${email}) from ${input.company} has registered and is waiting for approval.\n\nReview it here: ${appBaseUrl()}/admin/users`,
      ).catch(() => {}),
    ),
  );
  return u;
}

/** Email plus password, for both staff and users. */
export async function loginWithPassword(email: string, password: string) {
  const e = email.trim().toLowerCase();
  const s = await db.query.staff.findFirst({ where: eq(schema.staff.email, e) });
  if (s) {
    if (!verifyPassword(password, s.passwordHash)) throw unauthorized("Wrong email or password");
    return createSession("staff", s.id);
  }
  const u = await db.query.users.findFirst({ where: eq(schema.users.email, e) });
  // Verify before branching on status so a wrong password can't reveal account state.
  if (!u || !verifyPassword(password, u.passwordHash)) throw unauthorized("Wrong email or password");
  if (u.status === "pending") throw forbidden("Your registration is still waiting for approval. We'll email you when it's ready.");
  if (u.status === "rejected") throw forbidden("This account was not approved. Contact your administrator.");
  if (u.status === "paused") throw forbidden("This account is paused. Contact your administrator.");
  return createSession("user", u.id);
}

export async function approveRegistration(actor: AnyActor, userId: string) {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) throw notFound();
  if (u.status !== "pending" && u.status !== "rejected") throw conflict("That registration has already been handled");
  const [after] = await db
    .update(schema.users)
    .set({ status: "onboarding", onboardingStep: 2, approvedBy: actor.id, approvedAt: new Date(), rejectedReason: null })
    .where(eq(schema.users.id, userId))
    .returning();
  await sendEmail(
    u.email,
    "Your account is approved",
    `Hi ${u.name},\n\nYour account has been approved. Sign in to finish setting up your voice:\n${appBaseUrl()}/login`,
  ).catch(() => {});
  return after;
}

export async function rejectRegistration(actor: AnyActor, userId: string, reason: string) {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) throw notFound();
  if (u.status !== "pending") throw conflict("That registration has already been handled");
  const [after] = await db
    .update(schema.users)
    .set({ status: "rejected", rejectedReason: reason || null, approvedBy: actor.id, approvedAt: new Date() })
    .where(eq(schema.users.id, userId))
    .returning();
  return after;
}


// ── WhatsApp verification, at sign-up ─────────────────────────────────────

const WA_CODE_MINUTES = 15;

/**
 * Issues a 6-digit code and sends it over WhatsApp.
 *
 * Reuses `login_tokens` rather than columns on `users`: that table already has
 * expiry, single use and an attempt counter, which is exactly what an OTP
 * needs and what a bare `whatsapp_verify_code` column had none of.
 */
export async function sendWhatsappCode(userId: string) {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) throw notFound();
  if (u.whatsappVerifiedAt) throw conflict("That number is already verified");

  const code = randomDigits(6);
  await db.insert(schema.loginTokens).values({
    actorType: "user",
    actorId: u.id,
    tokenHash: sha256(`wa:${randomToken()}`), // unused for this flow, but the column is unique and not null
    otpHash: sha256(`wa:${u.id}:${code}`),
    expiresAt: new Date(Date.now() + WA_CODE_MINUTES * 60_000),
  });

  const { queueMessage } = await import("./whatsapp/outbox");
  await queueMessage({
    userId: u.id,
    phone: u.phoneE164,
    kind: "verify",
    text: `${code} is your CoPilot verification code. It expires in ${WA_CODE_MINUTES} minutes.`,
  });
  return { phone: u.phoneE164 };
}

/** Confirms the number. The account stays `pending` — an admin still approves it. */
export async function verifyWhatsappCode(email: string, code: string) {
  const e = email.trim().toLowerCase();
  const u = await db.query.users.findFirst({ where: eq(schema.users.email, e) });
  if (!u) throw unauthorized("Invalid code");
  if (u.whatsappVerifiedAt) return { alreadyVerified: true };

  const rows = await db.query.loginTokens.findMany({
    where: and(eq(schema.loginTokens.actorId, u.id), isNull(schema.loginTokens.usedAt), gt(schema.loginTokens.expiresAt, new Date())),
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: 3,
  });
  const hash = sha256(`wa:${u.id}:${code.trim()}`);
  const match = rows.find((r) => r.otpHash === hash && r.attempts < MAX_OTP_ATTEMPTS);
  if (!match) {
    for (const r of rows) await db.update(schema.loginTokens).set({ attempts: r.attempts + 1 }).where(eq(schema.loginTokens.id, r.id));
    throw unauthorized("That code is wrong or has expired");
  }
  await db.update(schema.loginTokens).set({ usedAt: new Date() }).where(eq(schema.loginTokens.id, match.id));
  await db.update(schema.users).set({ whatsappVerifiedAt: new Date(), whatsappVerifyCode: null }).where(eq(schema.users.id, u.id));
  return { alreadyVerified: false };
}
