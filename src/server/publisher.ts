import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

/**
 * Publishing is out of scope for this build: approved posts stop at `approved`.
 * The in-house publishing tool plugs in here later; posts already carry
 * `publish_at` and `publish_status` for it.
 */
export interface PublisherAdapter {
  readonly name: string;
  schedule(post: { id: string; userId: string; text: string; media: string[]; publishAt: Date }): Promise<void>;
}

export class NoopPublisher implements PublisherAdapter {
  readonly name = "noop";
  async schedule(post: { id: string; publishAt: Date }) {
    if (process.env.NODE_ENV !== "test") console.log(`[publisher:noop] post ${post.id} approved for ${post.publishAt.toISOString()}`);
    await db.update(schema.posts).set({ publishStatus: "logged" }).where(eq(schema.posts.id, post.id));
  }
}

export const publisher = (): PublisherAdapter => new NoopPublisher();
