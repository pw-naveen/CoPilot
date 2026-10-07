import { getSetting } from "../config";
import { toE164, type ConnectionState, type GatewayEvent, type InboundMessage, type WhatsAppGateway } from "./gateway";

/**
 * Evolution API v2 (self-hosted, unofficial WhatsApp client).
 * Endpoints used — verify against the deployed version:
 *   POST /message/sendText/{instance}            { number, text }
 *   POST /message/sendMedia/{instance}           { number, mediatype, mimetype, caption, media, fileName }
 *   POST /chat/sendPresence/{instance}           { number, presence: "composing", delay }
 *   GET  /instance/connectionState/{instance}    → { instance: { state } }
 *   GET  /instance/connect/{instance}            → { base64, code } (pairing QR)
 *   POST /webhook/set/{instance}                 { webhook: { enabled, url, events, ... } }
 *   POST /chat/getBase64FromMediaMessage/{instance} { message: { key } } → { base64, mimetype }
 * Webhook events: MESSAGES_UPSERT, CONNECTION_UPDATE, QRCODE_UPDATED
 * (payload `event` arrives as "messages.upsert" etc.).
 */
export const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"];

type Cfg = { url: string; key: string; instance: string };

export class EvolutionGateway implements WhatsAppGateway {
  readonly name = "evolution" as const;
  private handler: ((e: GatewayEvent) => Promise<void>) | null = null;

  constructor(private cfgOverride?: Cfg) {}

  private async cfg(): Promise<Cfg> {
    if (this.cfgOverride) return this.cfgOverride;
    const [url, key, instance] = await Promise.all([getSetting("evolution.url"), getSetting("evolution.api_key"), getSetting("evolution.instance")]);
    if (!url || !key || !instance) throw new Error("Evolution API is not configured (URL, API key and instance name)");
    return { url: url.replace(/\/$/, ""), key, instance };
  }

  private async call<T>(method: "GET" | "POST", path: (instance: string) => string, body?: unknown): Promise<T> {
    const c = await this.cfg();
    const res = await fetch(`${c.url}${path(encodeURIComponent(c.instance))}`, {
      method,
      headers: { apikey: c.key, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Evolution ${method} ${path(c.instance)} → ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private number = (e164: string) => e164.replace(/^\+/, "");

  async sendText(to: string, text: string) {
    const r = await this.call<{ key?: { id?: string } }>("POST", (i) => `/message/sendText/${i}`, { number: this.number(to), text });
    return { id: r.key?.id ?? "" };
  }

  async sendMedia(to: string, m: { url: string; mime: string; caption?: string; fileName?: string }) {
    const mediatype = m.mime.startsWith("image/") ? "image" : m.mime.startsWith("video/") ? "video" : "document";
    const r = await this.call<{ key?: { id?: string } }>("POST", (i) => `/message/sendMedia/${i}`, {
      number: this.number(to),
      mediatype,
      mimetype: m.mime,
      caption: m.caption ?? "",
      media: m.url,
      fileName: m.fileName ?? `file.${m.mime.split("/")[1] ?? "bin"}`,
    });
    return { id: r.key?.id ?? "" };
  }

  async sendTyping(to: string, ms: number) {
    await this.call("POST", (i) => `/chat/sendPresence/${i}`, { number: this.number(to), presence: "composing", delay: ms }).catch(() => {});
  }

  onMessage(handler: (e: GatewayEvent) => Promise<void>) {
    this.handler = handler;
  }

  async getStatus() {
    const r = await this.call<{ instance?: { state?: string }; state?: string }>("GET", (i) => `/instance/connectionState/${i}`);
    const state = normaliseState(r.instance?.state ?? r.state);
    if (state === "open") return { state };
    // Not linked yet: ask for a pairing QR code.
    const qr = await this.call<{ base64?: string; code?: string }>("GET", (i) => `/instance/connect/${i}`).catch(() => null);
    return { state, qr: qr?.base64 ?? null };
  }

  async registerWebhook(url: string) {
    await this.call("POST", (i) => `/webhook/set/${i}`, {
      webhook: { enabled: true, url, webhookByEvents: false, webhookBase64: false, events: WEBHOOK_EVENTS },
    });
  }

  async receive(payload: unknown) {
    const events = parseEvolution(payload);
    for (const e of events) await this.handler?.(e);
    return events;
  }

  async downloadMedia(msg: InboundMessage) {
    if (msg.media) return msg.media;
    const raw = msg.mediaRef as { key: unknown; message: unknown };
    const r = await this.call<{ base64: string; mimetype?: string }>("POST", (i) => `/chat/getBase64FromMediaMessage/${i}`, { message: raw, convertToMp4: false });
    return { data: Buffer.from(r.base64, "base64"), mime: r.mimetype ?? msg.mime ?? "application/octet-stream" };
  }
}

function normaliseState(s?: string): ConnectionState {
  if (s === "open" || s === "connecting" || s === "close") return s;
  if (s === "connected") return "open";
  return "unknown";
}

type EvoMsg = {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  message?: Record<string, any>;
  messageType?: string;
  messageTimestamp?: number;
  pushName?: string;
};

/** Evolution v2 webhook → gateway events. Unknown shapes are ignored, not thrown. */
export function parseEvolution(payload: unknown): GatewayEvent[] {
  const p = (payload ?? {}) as { event?: string; data?: unknown };
  const event = String(p.event ?? "").toLowerCase().replace(/_/g, ".");
  if (event === "connection.update") {
    const d = p.data as { state?: string };
    return [{ kind: "connection", state: normaliseState(d?.state) }];
  }
  if (event === "qrcode.updated") {
    const d = p.data as { qrcode?: { base64?: string }; base64?: string };
    const qr = d?.qrcode?.base64 ?? d?.base64;
    return qr ? [{ kind: "qr", qr }] : [];
  }
  if (event !== "messages.upsert") return [];
  const list = (Array.isArray(p.data) ? p.data : [p.data]) as EvoMsg[];
  const out: GatewayEvent[] = [];
  for (const d of list) {
    if (!d?.key?.id || d.key.fromMe || !d.key.remoteJid || d.key.remoteJid.endsWith("@g.us")) continue;
    const m = d.message ?? {};
    const base = { id: d.key.id, from: toE164(d.key.remoteJid), raw: d, at: d.messageTimestamp ? new Date(d.messageTimestamp * 1000) : new Date() };
    // Inline base64 (when webhookBase64 is on)
    const inline = typeof m.base64 === "string" ? m.base64 : undefined;
    if (m.conversation || m.extendedTextMessage?.text) {
      out.push({ kind: "message", message: { ...base, type: "text", text: m.conversation ?? m.extendedTextMessage.text } });
    } else if (m.audioMessage) {
      const mime = m.audioMessage.mimetype ?? "audio/ogg";
      out.push({ kind: "message", message: { ...base, type: "audio", mime, mediaRef: { key: d.key, message: m }, media: inline ? { data: Buffer.from(inline, "base64"), mime } : undefined } });
    } else if (m.imageMessage) {
      const mime = m.imageMessage.mimetype ?? "image/jpeg";
      out.push({ kind: "message", message: { ...base, type: "image", mime, caption: m.imageMessage.caption, mediaRef: { key: d.key, message: m }, media: inline ? { data: Buffer.from(inline, "base64"), mime } : undefined } });
    } else if (m.documentMessage || m.documentWithCaptionMessage) {
      const doc = m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage ?? {};
      const mime = doc.mimetype ?? "application/octet-stream";
      out.push({ kind: "message", message: { ...base, type: "document", mime, caption: doc.caption ?? doc.fileName, mediaRef: { key: d.key, message: m } } });
    }
  }
  return out;
}
