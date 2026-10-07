import { db, schema } from "@/db";
import type { AnyActor } from "./actor";

export async function audit(
  actor: AnyActor,
  e: {
    action: string;
    entity: string;
    entityId?: string | null;
    userId?: string | null;
    before?: unknown;
    after?: unknown;
  },
  tx: Pick<typeof db, "insert"> = db,
) {
  await tx.insert(schema.auditLog).values({
    actorType: actor.type,
    actorId: actor.id,
    userId: e.userId ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
  });
}
