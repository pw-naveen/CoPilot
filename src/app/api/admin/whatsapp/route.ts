import { z } from "zod";
import { body, route } from "@/server/http";
import { enqueue } from "@/server/jobs";
import { requireAdmin } from "@/server/scope";
import { unknownSenders } from "@/server/services/whatsapp";
import { cachedStatus, gateway, webhookUrl } from "@/server/whatsapp";

export const GET = route(async ({ actor }) => {
  requireAdmin(actor);
  return { gateway: gateway().name, status: await cachedStatus(), webhookUrl: await webhookUrl(), unknown: await unknownSenders(actor) };
});

/** Ask the worker to check the connection or (re)register the webhook. Returns a job to poll. */
export const POST = route(async ({ req, actor }) => {
  requireAdmin(actor);
  const { action } = await body(req, z.object({ action: z.enum(["check", "register_webhook"]) }));
  return { jobId: await enqueue(action === "check" ? "wa_check" : "wa_register_webhook", null, {}) };
});
