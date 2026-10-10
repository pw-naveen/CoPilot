import { z } from "zod";
import { body, route } from "@/server/http";
import { enqueue } from "@/server/jobs";
import { requireAdmin } from "@/server/scope";
import { e164 } from "@/server/services/accounts";
import { unknownSenders } from "@/server/services/whatsapp";
import { cachedStatus, diagnose, gatewayChoice, sendTestMessage, webhookUrl } from "@/server/whatsapp";

export const GET = route(async ({ actor }) => {
  requireAdmin(actor);
  const choice = await gatewayChoice();
  return {
    gateway: choice.name,
    reason: choice.reason,
    status: await cachedStatus(),
    webhookUrl: await webhookUrl(),
    unknown: await unknownSenders(actor),
  };
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check") }),
  z.object({ action: z.literal("register_webhook") }),
  z.object({ action: z.literal("test_message"), phone: e164 }),
]);

export const POST = route(async ({ req, actor }) => {
  requireAdmin(actor);
  const b = await body(req, input);
  // The check runs here, not on the worker: it is the button you press when
  // something is broken, and a queued job is useless if the worker is the thing
  // that is broken.
  if (b.action === "check") return { diagnosis: await diagnose() };
  if (b.action === "test_message")
    return {
      sent: await sendTestMessage(
        b.phone,
        "Test message from CoPilot. If you can read this, the Evolution instance can reach this number.",
      ),
    };
  return { jobId: await enqueue("wa_register_webhook", null, {}) };
});
