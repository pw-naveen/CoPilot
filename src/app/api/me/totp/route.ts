import QRCode from "qrcode";
import { z } from "zod";
import { beginTotpSetup, confirmTotpSetup, disableTotp } from "@/server/auth";
import { audit } from "@/server/audit";
import { body, route } from "@/server/http";
import { requireStaff } from "@/server/scope";

/** Start 2FA setup: returns a QR code for an authenticator app. */
export const POST = route(async ({ actor }) => {
  requireStaff(actor);
  const { secret, uri } = await beginTotpSetup(actor.id);
  return { secret, qr: await QRCode.toDataURL(uri) };
});

/** Confirm setup with a code from the app. */
export const PUT = route(async ({ req, actor }) => {
  requireStaff(actor);
  const { code } = await body(req, z.object({ code: z.string().min(6).max(6) }));
  await confirmTotpSetup(actor.id, code);
  await audit(actor, { action: "staff.totp_enable", entity: "staff", entityId: actor.id });
  return { ok: true };
});

export const DELETE = route(async ({ actor }) => {
  requireStaff(actor);
  await disableTotp(actor.id);
  await audit(actor, { action: "staff.totp_disable", entity: "staff", entityId: actor.id });
  return { ok: true };
});
