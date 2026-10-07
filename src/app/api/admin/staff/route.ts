import { body, route } from "@/server/http";
import { inviteStaffInput, inviteSubadmin, listStaff } from "@/server/services/accounts";

export const GET = route(async ({ actor }) => ({ staff: await listStaff(actor) }));

export const POST = route(async ({ req, actor }) => ({
  staff: await inviteSubadmin(actor, await body(req, inviteStaffInput)),
}));
