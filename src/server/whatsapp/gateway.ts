/**
 * All WhatsApp traffic goes through this one interface, so moving from the
 * self-hosted Evolution API to the official WhatsApp Cloud API later means writing
 * one new implementation. Pick one with WHATSAPP_GATEWAY=mock|evolution.
 */
export type InboundMessage = {
  id: string; // provider message id (dedupe key)
  from: string; // E.164
  type: "text" | "audio" | "image" | "document";
  text?: string;
  caption?: string;
  /** Provider reference used to download media later (e.g. the raw Evolution message). */
  mediaRef?: unknown;
  /** Media bytes when the provider delivers them inline (base64 webhooks, mock). */
  media?: { data: Buffer; mime: string };
  mime?: string;
  raw: unknown;
  at: Date;
};

export type GatewayEvent =
  | { kind: "message"; message: InboundMessage }
  | { kind: "connection"; state: ConnectionState }
  | { kind: "qr"; qr: string };

export type ConnectionState = "open" | "connecting" | "close" | "unknown";
export type GatewayStatus = { state: ConnectionState; qr?: string | null; detail?: string };

export interface WhatsAppGateway {
  readonly name: "mock" | "evolution";
  sendText(to: string, text: string): Promise<{ id: string }>;
  sendMedia(to: string, media: { url: string; mime: string; caption?: string; fileName?: string }): Promise<{ id: string }>;
  /** Registers the inbound handler; webhook deliveries are turned into events and passed to it. */
  onMessage(handler: (e: GatewayEvent) => Promise<void>): void;
  getStatus(): Promise<GatewayStatus>;
  // ── helpers used by the webhook route and worker ──
  /** Parse a raw webhook payload into events and pass them to the registered handler. */
  receive(payload: unknown): Promise<GatewayEvent[]>;
  downloadMedia(msg: InboundMessage): Promise<{ data: Buffer; mime: string }>;
  sendTyping?(to: string, ms: number): Promise<void>;
  registerWebhook?(url: string): Promise<void>;
}

export const toE164 = (jidOrNumber: string) => {
  const digits = jidOrNumber.split("@")[0].split(":")[0].replace(/\D/g, "");
  return `+${digits}`;
};
