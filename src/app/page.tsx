import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { pageActor } from "@/server/page-auth";

export default async function Home() {
  const actor = await pageActor();
  if (actor.type === "staff") redirect("/admin");
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, actor.id) });
  if (u && u.status !== "active" && u.status !== "paused") redirect("/onboarding");
  redirect("/calendar");
}
