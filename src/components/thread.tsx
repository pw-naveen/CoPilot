"use client";

import { useEffect, useRef } from "react";
import { DateTime } from "luxon";
import { Icon, cx } from "./ui";

export type ThreadMsg = {
  id: string;
  direction: "in" | "out";
  status: string;
  type: string;
  body: string | null;
  transcript: string | null;
  mediaUrl: string | null;
  createdAt: string | Date;
  sendAfter?: string | Date | null;
};

/**
 * A WhatsApp conversation. "in" = from the user, "out" = from the assistant.
 *
 * `perspective` says whose messages sit on the right. The account holder reading
 * their own record expects what their phone shows, so that is the default; staff
 * looking at someone else's thread read the assistant's side as "ours".
 */
export function Thread({ messages, perspective = "phone" }: { messages: ThreadMsg[]; perspective?: "assistant" | "phone" }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.length]);
  if (!messages.length) return <p className="py-16 text-center text-[14px] text-muted">No messages yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {messages.map((m) => {
        // On the phone, the account holder's own messages sit on the right.
        const mine = perspective === "phone" ? m.direction === "in" : m.direction === "out";
        return (
          <div key={m.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
            <div className={cx("max-w-[78%] rounded-[16px] px-4 py-2.5 text-[14px] leading-relaxed shadow-card", mine ? "bg-blush-100 text-ink" : "bg-surface-raised text-ink")}>
              {m.type === "image" && m.mediaUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.mediaUrl} alt="" className="mb-2 max-h-56 rounded-[12px] object-cover" />
              )}
              {m.type === "audio" && (
                <div className="mb-1 flex items-center gap-2 text-[13px] text-muted">
                  <Icon name="microphone" size={16} /> Voice note
                  {m.mediaUrl && <audio src={m.mediaUrl} controls className="h-8 max-w-[200px]" />}
                </div>
              )}
              {m.body && <p className="whitespace-pre-wrap break-words">{linkify(m.body)}</p>}
              {m.transcript && <p className="mt-1 text-[13px] text-muted italic">“{m.transcript}”</p>}
              <p className="mt-1 text-right text-[11px] text-muted">
                {DateTime.fromJSDate(new Date(m.createdAt)).toFormat("d LLL HH:mm")}
                {m.direction === "out" && m.status !== "sent" && ` · ${m.status === "queued" && m.sendAfter && new Date(m.sendAfter) > new Date(m.createdAt) ? `held until ${DateTime.fromJSDate(new Date(m.sendAfter)).toFormat("HH:mm")}` : m.status}`}
              </p>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function linkify(t: string) {
  return t.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="link break-all" target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
