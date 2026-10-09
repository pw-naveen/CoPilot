import { staffActor } from "@/server/page-auth";
import { listOrganizations } from "@/server/services/organizations";
import { PageHeader } from "@/components/ui";
import { OrganizationsClient } from "./organizations-client";

export const dynamic = "force-dynamic";

/**
 * Organizations and the brief each one applies to everyone in it. Admin only:
 * the brief overrides each member's persona, so it is not a sub-admin's to edit.
 */
export default async function OrganizationsPage() {
  const actor = await staffActor();
  const organizations = await listOrganizations(actor);
  return (
    <>
      <PageHeader
        eyebrow="Organizations"
        lead="One brief,"
        accent="everyone in the company."
        intro="New sign-ups pick their organization from this list, and its brief rides along with every draft, review and rewrite for its people."
      />
      <OrganizationsClient
        initial={organizations.map((o) => ({
          id: o.id,
          name: o.name,
          context: o.context,
          active: o.active,
          members: o.members,
        }))}
      />
    </>
  );
}
