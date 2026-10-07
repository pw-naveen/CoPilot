import { and, eq, gt, isNull } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import { db, schema } from "@/db";
import type { Actor } from "./actor";
import { decrypt, encrypt, randomDigits, randomToken, sha256 } from "./crypto";
import { sendEmail } from "./email";
import { appBaseUrl } from "./config";
import { unauthorized } from "./errors";

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
    issuer: "Persona",
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
