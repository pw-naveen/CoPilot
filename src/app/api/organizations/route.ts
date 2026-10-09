import { publicRoute } from "@/server/http";
import { selectableOrganizations } from "@/server/services/organizations";

/**
 * Names only, and only the active ones: the register form needs the list before
 * anyone has an account, so it must be reachable without a session.
 */
export const GET = publicRoute(async () => ({ organizations: await selectableOrganizations() }));
