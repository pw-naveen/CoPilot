import { z } from "zod";
import { approveRegistration, rejectRegistration } from "@/server/auth";
import { audit } from "@/server/audit";
import { body, route } from "@/server/http";
import { requireAdmin } from "@/server/scope";

/** Admin decision on a self-registered account. */
export const POST = route<{ userId: string }>(async ({ req, actor, params }) => {
  requireAdmin(actor);
  const { decision, reason } = await body(
    req,
    z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().max(500).optional() }),
  );
  const user =
    decision === "approve"
      ? await approveRegistration(actor, params.userId)
      : await rejectRegistration(actor, params.userId, reason ?? "");
  await audit(actor, {
    action: `registration.${decision}`,
    entity: "user",
    entityId: params.userId,
    userId: params.userId,
    after: { status: user.status },
  });
  return { user: { id: user.id, status: user.status } };
});
