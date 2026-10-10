import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { appBaseUrl, getSetting } from "../config";
import { sendEmail } from "../email";
import { redis } from "../queue";
import { EvolutionGateway } from "./evolution";
import type { GatewayStatus, WhatsAppGateway } from "./gateway";
import { MockGateway } from "./mock";

let instance: WhatsAppGateway | null = null;
let pinned: WhatsAppGateway | null = null;

export type GatewayChoice = { name: "evolution" | "mock"; reason: string };

/**
 * Which gateway to use, and why.
 *
 * The Evolution credentials are entered in Settings, not in the environment, so
 * saving them there has to be what turns the real gateway on — otherwise an
 * admin fills the form, nothing changes, and "Check connection" cheerfully
 * reports the mock as healthy. `WHATSAPP_GATEWAY=mock` still forces the mock
 * (tests and offline development rely on it), but it is now a deliberate
 * override that the settings page names rather than a silent default.
 */
export async function gatewayChoice(): Promise<GatewayChoice> {
  if (process.env.WHATSAPP_GATEWAY === "mock")
    return { name: "mock", reason: "WHATSAPP_GATEWAY=mock in the environment is forcing the mock gateway." };
  const [url, key, inst] = await Promise.all([
    getSetting("evolution.url"),
    getSetting("evolution.api_key"),
    getSetting("evolution.instance"),
  ]);
  if (url && key && inst) return { name: "evolution", reason: "Evolution is configured in Settings." };
  if (process.env.WHATSAPP_GATEWAY === "evolution")
    return { name: "evolution", reason: "WHATSAPP_GATEWAY=evolution, but the URL, API key and instance are not all saved in Settings." };
  const missing = [!url && "URL", !key && "API key", !inst && "instance name"].filter(Boolean).join(", ");
  return { name: "mock", reason: `Evolution is not configured yet — missing ${missing}. Using the mock gateway.` };
}

/** The configured gateway. Resolved from Settings, so saving credentials is enough. */
export async function gateway(): Promise<WhatsAppGateway> {
  if (pinned) return pinned;
  const { name } = await gatewayChoice();
  if (!instance || instance.name !== name) {
    instance = name === "evolution" ? new EvolutionGateway() : new MockGateway();
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
  pinned = g;
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
  const next: CachedStatus = { state: "unknown", ...prev, ...patch, checkedAt: new Date().toISOString(), gateway: (await gateway()).name };
  if (next.state === "open") next.qr = null;
  await redis().set(STATUS_KEY, JSON.stringify(next));
  return { prev, next };
}

/** Worker: ask the gateway for its state; email admins when the session drops. */
export async function checkConnection() {
  let status: GatewayStatus;
  try {
    status = await (await gateway()).getStatus();
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

// ── admin diagnostics ─────────────────────────────────────────────────────

export type Diagnosis = {
  gateway: "evolution" | "mock";
  reason: string;
  /** What it actually tried. The API key is never returned, only whether it is set. */
  target: { url: string | null; instance: string | null; apiKey: boolean; webhookSecret: boolean };
  ok: boolean;
  state: string;
  qr?: string | null;
  detail?: string;
  checkedAt: string;
};

/**
 * Hit the configured Evolution instance for real and report what came back.
 *
 * Runs inline rather than through the worker: this is the button an admin
 * presses when something is wrong, and a queued job is no use when the thing
 * that is wrong is that nothing is draining the queue.
 */
export async function diagnose(): Promise<Diagnosis> {
  const choice = await gatewayChoice();
  const [url, instance, key, secret] = await Promise.all([
    getSetting("evolution.url"),
    getSetting("evolution.instance"),
    getSetting("evolution.api_key"),
    getSetting("evolution.webhook_secret"),
  ]);
  const target = { url: url ?? null, instance: instance ?? null, apiKey: !!key, webhookSecret: !!secret };

  let status: GatewayStatus;
  try {
    status = await (await gateway()).getStatus();
  } catch (err) {
    status = { state: "unknown", detail: String(err instanceof Error ? err.message : err).slice(0, 400) };
  }
  await storeStatus(status);
  return {
    gateway: choice.name,
    reason: choice.reason,
    target,
    ok: status.state === "open",
    state: status.state,
    qr: status.qr ?? null,
    detail: status.detail,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Send one real message, now, straight through the gateway — no outbox, no
 * quiet hours, no retry. Proves the credentials and the instance can actually
 * reach a handset, which a connection state alone does not.
 */
export async function sendTestMessage(to: string, text: string) {
  const g = await gateway();
  const { id } = await g.sendText(to, text);
  return { gateway: g.name, to, id };
}
