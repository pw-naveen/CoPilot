import { z } from "zod";
import { body, route } from "@/server/http";
import { accountSettingsInput, deleteUser, getUser, suspendUser, updateAccountSettings } from "@/server/services/accounts";
import { requireStaff } from "@/server/scope";

type P = { userId: string };

export const GET = route<P>(async ({ actor, params }) => {
  requireStaff(actor);
  return { user: await getUser(actor, params.userId) };
});

export const PATCH = route<P>(async ({ req, actor, params }) => ({
  user: await updateAccountSettings(actor, params.userId, await body(req, accountSettingsInput)),
}));

const suspendInput = z.object({ suspend: z.boolean() });

/** Suspend or resume. Separate from PATCH so the audit trail names the act. */
export const POST = route<P>(async ({ req, actor, params }) => ({
  user: await suspendUser(actor, params.userId, (await body(req, suspendInput)).suspend),
}));

const deleteInput = z.object({ confirmEmail: z.string() });

export const DELETE = route<P>(async ({ req, actor, params }) => {
  await deleteUser(actor, params.userId, (await body(req, deleteInput)).confirmEmail);
  return { ok: true };
});
