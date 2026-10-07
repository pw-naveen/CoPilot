export type StaffActor = {
  type: "staff";
  id: string;
  role: "admin" | "subadmin";
  name: string;
  email: string;
  canInvite: boolean;
};
export type UserActor = { type: "user"; id: string; name: string; email: string };
export type SystemActor = { type: "system"; id: string };
export type Actor = StaffActor | UserActor;
export type AnyActor = Actor | SystemActor;

export const SYSTEM: SystemActor = { type: "system", id: "system" };

export const isAdmin = (a: AnyActor): a is StaffActor => a.type === "staff" && a.role === "admin";
export const isStaff = (a: AnyActor): a is StaffActor => a.type === "staff";

/** Stored in created_by / approved_by columns. */
export const actorRef = (a: AnyActor) => `${a.type}:${a.id}`;
