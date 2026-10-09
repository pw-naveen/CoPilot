import { body, route } from "@/server/http";
import { createOrganization, listOrganizations, organizationInput } from "@/server/services/organizations";

export const GET = route(async ({ actor }) => ({ organizations: await listOrganizations(actor) }));

export const POST = route(async ({ req, actor }) => ({
  organization: await createOrganization(actor, await body(req, organizationInput)),
}));
