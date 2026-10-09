import { body, route } from "@/server/http";
import { deleteOrganization, organizationInput, updateOrganization } from "@/server/services/organizations";

type P = { orgId: string };

export const PATCH = route<P>(async ({ req, actor, params }) => ({
  organization: await updateOrganization(actor, params.orgId, await body(req, organizationInput.partial())),
}));

export const DELETE = route<P>(async ({ actor, params }) => {
  await deleteOrganization(actor, params.orgId);
  return { ok: true };
});
