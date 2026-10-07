import { route } from "@/server/http";
import { thread } from "@/server/services/whatsapp";

export const GET = route<{ userId: string }>(async ({ actor, params }) => ({ messages: await thread(actor, params.userId) }));
