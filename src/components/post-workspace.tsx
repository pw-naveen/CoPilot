"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { api } from "@/lib/api";
import type { PostView } from "@/server/services/posts";
import { LinkedInPreview } from "./linkedin-preview";
import { Recorder } from "./recorder";
import { Button, Card, Icon, Label, Notice, Select, StatusPill, Statement, Textarea, cx } from "./ui";

type View = Omit<PostView, "slot" | "versions"> & {
  slot: { id: string; publishAt: string; approvalDeadline: string; status: string } | null;
  versions: (Omit<PostView["versions"][number], "createdAt"> & { createdAt: string })[];
};

/**
 * Review a draft: LinkedIn-style preview, approve, request changes (typed or voice),
 * edit inline, swap images, move slot, version history. Used on the WhatsApp preview
 * link (no login), the user's post page, and the staff post page.
 */
export function PostWorkspace({ view: initial, apiBase, mode, isAdmin = false }: { view: View; apiBase: string; mode: "preview" | "user" | "staff"; isAdmin?: boolean }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [panel, setPanel] = useState<null | "changes" | "edit" | "images" | "move">(null);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [slotId, setSlotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "alert"; text: string } | null>(null);

  const tz = view.user.timezone;
  const current = view.versions.find((v) => v.id === view.post.currentVersionId) ?? view.versions[0];
  const status = view.post.status;
  const working = status === "drafting" || status === "changes_requested";
  const open = status === "pending_approval";
  const now = Date.now();
  const deadline = view.slot ? new Date(view.slot.approvalDeadline) : null;
  const pastDeadline = !!deadline && deadline.getTime() <= now;
  const hoursLeft = deadline ? Math.max(0, Math.round((deadline.getTime() - now) / 3600_000)) : null;
  const images = (current?.media ?? []).map((id) => view.media.find((m) => m.id === id)).filter(Boolean) as View["media"];

  async function reload() {
    const next = await api<View>(apiBase);
    // A rewrite just finished: drop the "rewriting" note.
    if (working && next.post.status === "pending_approval") setMsg({ tone: "info", text: "Here's the new version." });
    setView(next);
    if (mode !== "preview") router.refresh();
  }

  // While the assistant rewrites, keep checking.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(reload, 2500);
    return () => clearInterval(t);
  }, [working]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(body: object, done?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ result: { final?: boolean } | null }>(apiBase, { body });
      setPanel(null);
      if (r.result && r.result.final === false) setMsg({ tone: "info", text: `Approved on ${view.user.displayName}'s behalf. They still need to approve it themselves (account setting).` });
      else if (done) setMsg({ tone: "info", text: done });
      await reload().catch(() => setView({ ...view, post: { ...view.post, status: "approved" } }));
    } catch (e) {
      setMsg({ tone: "alert", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function sendVoice(blob: Blob) {
    setBusy(true);
    const form = new FormData();
    form.set("audio", new File([blob], "feedback.webm", { type: blob.type }));
    form.set("feedback", feedback);
    const res = await fetch(`${apiBase}/audio`, { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) return setMsg({ tone: "alert", text: (await res.json()).error });
    setPanel(null);
    setFeedback("");
    setMsg({ tone: "info", text: "Got it. Rewriting with your voice note…" });
    await reload();
  }

  const fmt = (iso: string, f = "cccc d LLL, h:mma") => DateTime.fromISO(iso, { zone: tz }).toFormat(f).replace("AM", "am").replace("PM", "pm");

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-6">
        {view.post.flaggedForStaff && (
          <Statement>
            <Label>Held for review</Label>
            <p className="mt-2 text-[14px]">{mode === "staff" ? "This draft failed the persona and compliance review twice and hasn't been sent. Fix it, then release it." : "The team is checking this draft before it reaches you."}</p>
            {mode === "staff" && view.post.reviewIssues.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-[14px] text-ink-soft">
                {view.post.reviewIssues.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            )}
          </Statement>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className={cx("transition-opacity", working && "opacity-40")}>
          <LinkedInPreview
            name={view.user.displayName}
            headline={view.user.headline}
            photoUrl={view.user.photoUrl}
            text={panel === "edit" ? text : current?.text ?? ""}
            images={images.map((m) => ({ id: m.id, url: m.url }))}
            when={view.slot ? fmt(view.slot.publishAt, "d LLL") : "Draft"}
          />
        </div>
        {working && <Notice>Rewriting your draft. This page updates when it's ready.</Notice>}
        {view.post.firstComment && (
          <Card>
            <Label>Suggested first comment</Label>
            <p className="mt-2 text-[14px] whitespace-pre-wrap">{view.post.firstComment}</p>
          </Card>
        )}

        {panel === "edit" && (
          <Card className="flex flex-col gap-3">
            <Label>Edit the text</Label>
            <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !text.trim()} onClick={() => act({ action: "edit", text }, "Saved as a new version.")}>
                Save edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}
        {panel === "changes" && (
          <Card className="flex flex-col gap-3">
            <Label>What should change?</Label>
            <Textarea autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. Shorter opening, mention the nurses by team not name" />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy || !feedback.trim()} onClick={() => act({ action: "changes", feedback }, "Got it. Rewriting now…")}>
                Send
              </Button>
              <Recorder onDone={sendVoice} disabled={busy} label="Or say it" />
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}
        {panel === "images" && (
          <Card className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <Label>Images</Label>
              <span className="text-[12px] text-muted">{picked.length} of 4 selected</span>
            </div>
            {view.media.length === 0 ? (
              <p className="text-[14px] text-muted">No photos yet. Send them on WhatsApp and they'll appear here.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {view.media.map((m) => {
                  const on = picked.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPicked(on ? picked.filter((x) => x !== m.id) : picked.length < 4 ? [...picked, m.id] : picked)}
                      className={cx("relative overflow-hidden rounded-[12px]", on && "ring-2 ring-red")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url} alt={m.description ?? ""} className="aspect-square w-full object-cover" />
                      {on && (
                        <span className="absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-red">
                          <Icon name="check" size={14} className="text-white" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => act({ action: "media", mediaIds: picked }, "Images updated.")}>
                Save images
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}
        {panel === "move" && (
          <Card className="flex flex-col gap-3">
            <Label>Move to another slot</Label>
            {view.freeSlots.length === 0 ? (
              <p className="text-[14px] text-muted">No free slots right now.</p>
            ) : (
              <Select value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                <option value="">Choose a slot…</option>
                {view.freeSlots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fmt(String(s.publishAt))}
                  </option>
                ))}
              </Select>
            )}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !slotId} onClick={() => act({ action: "move", slotId }, "Moved.")}>
                Move
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}
      </div>

      <aside className="flex flex-col gap-6 lg:sticky lg:top-24">
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <StatusPill status={status} />
            {view.post.suggestedTopic && <span className="text-[12px] font-semibold text-red-text">Suggested topic</span>}
          </div>
          {view.slot && (
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-y-2 text-[14px]">
              <dt className="text-muted">Goes out</dt>
              <dd className="font-semibold text-ink">{fmt(view.slot.publishAt)}</dd>
              <dt className="text-muted">Approve by</dt>
              <dd className={cx("font-semibold", pastDeadline ? "text-red-text" : "text-ink")}>
                {fmt(view.slot.approvalDeadline)}
                {open && !pastDeadline && hoursLeft !== null && <span className="block text-[12px] font-normal text-muted">{hoursLeft < 48 ? `${hoursLeft} hours left` : `${Math.round(hoursLeft / 24)} days left`}</span>}
              </dd>
            </dl>
          )}
          {view.post.staffApprovedBy && open && <Notice>{view.post.staffApprovedBy} approved this on your behalf. Your approval is still needed.</Notice>}
          {status === "approved" && (
            <Notice>
              Approved{view.post.approvedBy ? ` by ${view.post.approvedBy}` : ""}. It will go out as scheduled.
            </Notice>
          )}
          {status === "missed" && <Notice tone="alert">The approval deadline passed. Move it to a later slot to use it.</Notice>}

          {open && !view.post.flaggedForStaff && (
            <div className="flex flex-col gap-2">
              {!pastDeadline && (
                <Button disabled={busy} onClick={() => act({ action: "approve" }, "Approved.")}>
                  <Icon name="check" size={18} className="text-white" />
                  Approve
                </Button>
              )}
              {pastDeadline && isAdmin && (
                <Button variant="danger" disabled={busy} onClick={() => act({ action: "approve", override: true }, "Approved with admin override.")}>
                  Approve anyway (admin override)
                </Button>
              )}
              <Button variant="secondary" disabled={busy} onClick={() => setPanel("changes")}>
                Request changes
              </Button>
            </div>
          )}
          {(open || status === "missed") && (
            <div className="flex flex-wrap gap-1">
              {open && (
                <Button size="sm" variant="ghost" onClick={() => { setText(current?.text ?? ""); setPanel("edit"); }}>
                  <Icon name="pencil-simple" size={16} className="text-current" /> Edit
                </Button>
              )}
              {open && (
                <Button size="sm" variant="ghost" onClick={() => { setPicked(current?.media ?? []); setPanel("images"); }}>
                  <Icon name="image" size={16} className="text-current" /> Images
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setPanel("move")}>
                <Icon name="arrows-left-right" size={16} className="text-current" /> Move
              </Button>
            </div>
          )}
          {mode === "staff" && view.post.flaggedForStaff && (
            <div className="flex flex-col gap-2">
              <Button variant="secondary" onClick={() => { setText(current?.text ?? ""); setPanel("edit"); }}>
                Edit draft
              </Button>
              <Button disabled={busy} onClick={() => act({ action: "release" }, `Sent to ${view.user.displayName}.`)}>
                Release to {view.user.displayName}
              </Button>
            </div>
          )}
        </Card>

        <Card className="p-0">
          <p className="card-title px-6 pt-5 pb-3">Versions</p>
          <ul className="divide-y divide-line">
            {view.versions.map((v) => (
              <li key={v.id} className="flex items-start gap-3 px-6 py-3 text-[13px]">
                <span className={cx("mt-0.5 w-7 font-bold", v.id === current?.id ? "text-red-text" : "text-ink")}>v{v.number}</span>
                <span className="flex-1">
                  <span className="block text-ink">
                    {v.createdBy}
                    {v.byStaff && mode !== "staff" && " (for you)"}
                  </span>
                  {v.feedback && <span className="block text-muted">“{v.feedback.slice(0, 90)}”</span>}
                  <span className="text-muted">{DateTime.fromISO(v.createdAt).toFormat("d LLL, HH:mm")}</span>
                </span>
                {open && v.id !== current?.id && (
                  <button className="link text-[12px]" onClick={() => act({ action: "revert", versionId: v.id }, `Restored version ${v.number}.`)}>
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}
