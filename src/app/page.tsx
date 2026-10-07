import { pageActor } from "@/server/page-auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const actor = await pageActor();
  if (actor.type === "staff") redirect("/admin");
  return <main className="p-10">Welcome, {actor.name}.</main>;
}
