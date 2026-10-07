import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { appBaseUrl, getSetting } from "../config";
import { sendEmail } from "../email";
import { redis } from "../queue";
import { EvolutionGateway } from "./evolution";
import type { GatewayStatus, WhatsAppGateway } from "./gateway";
import { MockGateway } from "./mock";

let instance: WhatsAppGateway | null = null;

/** The configured gateway. Swapping WHATSAPP_GATEWAY is the only change needed. */
export function gateway(): WhatsAppGateway {
  if (!instance) {
    instance = process.env.WHATSAPP_GATEWAY === "evolution" ? new EvolutionGateway() : new MockGateway();
    // Inbound messages from any gateway land in the same pipeline.
    instance.onMessage(async (e) => {
      const { handleGatewayEvent } = await import("./inbound");
      await handleGatewayEvent(e);
    });
  }
  return instance;
}

/** Test hook: replace the gateway (e.g. an Evolution gateway pointed at a fake server). */
export function setGateway(g: WhatsAppGateway | null) {
  instance = g;
  if (g)
    g.onMessage(async (e) => {
      const { handleGatewayEvent } = await import("./inbound");
      await handleGatewayEvent(e);
    });
}

export const mockGateway = () => new MockGateway();

export const webhookUrl = async () => {
  const secret = await getSetting("evolution.webhook_secret");
  return `${appBaseUrl()}/api/webhooks/evolution${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`;
};

// ── connection status (checked by the worker, cached for the admin page) ──

const STATUS_KEY = "wa:status";
export type CachedStatus = GatewayStatus & { checkedAt: string; gateway: string };

export async function cachedStatus(): Promise<CachedStatus | null> {
  const raw = await redis().get(STATUS_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function storeStatus(patch: Partial<GatewayStatus>) {
  const prev = await cachedStatus();
  const next: CachedStatus = { state: "unknown", ...prev, ...patch, checkedAt: new Date().toISOString(), gateway: gateway().name };
  if (next.state === "open") next.qr = null;
  await redis().set(STATUS_KEY, JSON.stringify(next));
  return { prev, next };
}

/** Worker: ask the gateway for its state; email admins when the session drops. */
export async function checkConnection() {
  let status: GatewayStatus;
  try {
    status = await gateway().getStatus();
  } catch (err) {
    status = { state: "unknown", detail: String(err).slice(0, 300) };
  }
  const { prev } = await storeStatus(status);
  const dropped = status.state !== "open" && (prev?.state === "open" || !prev);
  const lastAlert = Number((await redis().get("wa:last_alert")) ?? 0);
  if (dropped || (status.state !== "open" && Date.now() - lastAlert > 6 * 3600_000)) {
    await redis().set("wa:last_alert", String(Date.now()));
    const admins = await db.select().from(schema.staff).where(eq(schema.staff.role, "admin"));
    for (const a of admins)
      await sendEmail(
        a.email,
        "WhatsApp connection is down",
        `The WhatsApp session is "${status.state}"${status.detail ? ` (${status.detail})` : ""}.\n\nOutbound messages are queued and drafts and reminders fall back to email after 2 hours.\n\nReconnect: ${appBaseUrl()}/admin/settings`,
      );
  }
  return status;
}
