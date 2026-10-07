import { body, route } from "@/server/http";
import { inviteUser, inviteUserInput, listUsers } from "@/server/services/accounts";

export const GET = route(async ({ actor }) => ({ users: await listUsers(actor) }));

export const POST = route(async ({ req, actor }) => {
  const user = await inviteUser(actor, await body(req, inviteUserInput));
  return { user };
});
