import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor, StaffActor, UserActor } from "./actor";
import { resolveSession, SESSION_COOKIE } from "./auth";

export async function pageActor(): Promise<Actor> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = await resolveSession(raw);
  if (!s) redirect("/login");
  if (s.needsTotp) redirect("/login/totp");
  return s.actor;
}

export async function optionalActor(): Promise<Actor | null> {
  const s = await resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
  return s && !s.needsTotp ? s.actor : null;
}

export async function staffActor(): Promise<StaffActor> {
  const a = await pageActor();
  if (a.type !== "staff") redirect("/");
  return a;
}

export async function userActor(): Promise<UserActor> {
  const a = await pageActor();
  if (a.type !== "user") redirect("/admin");
  return a;
}
