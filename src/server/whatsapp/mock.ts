import { randomToken } from "../crypto";
import type { GatewayEvent, InboundMessage, WhatsAppGateway } from "./gateway";

/**
 * In-process stand-in for WhatsApp. Outbound messages are already recorded in
 * wa_messages by the outbox, so the dev "phone" page reads them from there.
 * Inbound messages come from that page via receive().
 */
export type MockInbound = {
  from: string;
  text?: string;
  media?: { base64: string; mime: string; fileName?: string };
  caption?: string;
};

export class MockGateway implements WhatsAppGateway {
  readonly name = "mock" as const;
  private handler: ((e: GatewayEvent) => Promise<void>) | null = null;
  /** Tests can flip this to simulate a dropped session. */
  static connected = true;
  static sent: { to: string; text?: string; media?: string }[] = [];

  async sendText(to: string, text: string) {
    if (!MockGateway.connected) throw new Error("mock gateway disconnected");
    MockGateway.sent.push({ to, text });
    return { id: `mock-out-${randomToken(9)}` };
  }

  async sendMedia(to: string, media: { url: string; caption?: string }) {
    if (!MockGateway.connected) throw new Error("mock gateway disconnected");
    MockGateway.sent.push({ to, media: media.url, text: media.caption });
    return { id: `mock-out-${randomToken(9)}` };
  }

  onMessage(handler: (e: GatewayEvent) => Promise<void>) {
    this.handler = handler;
  }

  async getStatus() {
    return { state: MockGateway.connected ? ("open" as const) : ("close" as const) };
  }

  async receive(payload: unknown) {
    const p = payload as MockInbound;
    const type: InboundMessage["type"] = p.media ? (p.media.mime.startsWith("audio/") ? "audio" : p.media.mime.startsWith("image/") ? "image" : "document") : "text";
    const message: InboundMessage = {
      id: `mock-in-${randomToken(9)}`,
      from: p.from,
      type,
      text: p.text,
      caption: p.caption,
      media: p.media ? { data: Buffer.from(p.media.base64, "base64"), mime: p.media.mime } : undefined,
      mime: p.media?.mime,
      raw: { ...p, media: p.media ? { mime: p.media.mime, bytes: p.media.base64.length } : undefined },
      at: new Date(),
    };
    const events: GatewayEvent[] = [{ kind: "message", message }];
    for (const e of events) await this.handler?.(e);
    return events;
  }

  async downloadMedia(msg: InboundMessage) {
    if (!msg.media) throw new Error("no media");
    return msg.media;
  }

  async sendTyping() {}
}
