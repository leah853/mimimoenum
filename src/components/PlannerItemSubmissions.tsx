"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HiOutlinePaperClip, HiOutlineLink, HiOutlineDocumentText, HiOutlineTrash } from "react-icons/hi";

export interface PlannerAttachment {
  id: string;
  kind: "file" | "link" | "text";
  filename: string;
  link_url?: string | null;
  text_body?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  uploaded_by: string;
  uploaded_at: string;
  reviewed: boolean;
}

export interface PlannerComment {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

function when(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function sizeLabel(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Deliverables and feedback for one planner card — the milestone-tree module
 * reproduced for the planner. Deliverables are authored by owners; feedback is
 * open to everyone, since reviewing is what reps are here to do even though
 * the plan itself is read-only to them.
 */
export default function PlannerItemSubmissions({
  itemId,
  boardParam,
  canAttach,
}: {
  itemId: string;
  boardParam: string | null;
  canAttach: boolean;
}) {
  const suffix = boardParam ? `?board=${encodeURIComponent(boardParam)}` : "";
  const base = `/api/planner/items/${itemId}`;

  const [attachments, setAttachments] = useState<PlannerAttachment[] | null>(null);
  const [comments, setComments] = useState<PlannerComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [addKind, setAddKind] = useState<"link" | "text" | null>(null);
  const [label, setLabel] = useState("");
  const [payload, setPayload] = useState("");
  const [comment, setComment] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    // Check status rather than shape: a failed request returns an error object,
    // and treating that as "no items" would quietly hide a broken table.
    const read = async (path: string) => {
      const res = await fetch(path);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return Array.isArray(json) ? json : [];
    };
    try {
      const [a, f] = await Promise.all([
        read(`${base}/attachments${suffix}`),
        read(`${base}/feedback${suffix}`),
      ]);
      setAttachments(a);
      setComments(f);
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setAttachments([]);
      setComments([]);
      setError(
        /planner_item|schema cache|does not exist/i.test(message)
          ? "Deliverables and feedback need a migration: run supabase/migrations/20260825_planner_item_submissions.sql."
          : `Could not load deliverables and feedback. ${message}`
      );
    }
  }, [base, suffix]);

  useEffect(() => {
    setAttachments(null);
    setComments(null);
    setError(null);
    void load();
  }, [load]);

  async function post(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/attachments${suffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    } finally {
      setBusy(false);
    }
  }

  async function addLinkOrText() {
    if (!label.trim() || !payload.trim() || !addKind) return;
    try {
      await post(
        addKind === "link"
          ? { kind: "link", filename: label.trim(), link_url: payload.trim() }
          : { kind: "text", filename: label.trim(), text_body: payload.trim() }
      );
      setLabel("");
      setPayload("");
      setAddKind(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add deliverable");
    }
  }

  async function uploadFile(file: File) {
    try {
      // Two steps: reserve a row and a signed URL, then PUT the bytes straight
      // to storage so the file never passes through the serverless function.
      const json = await post({
        kind: "file",
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      });
      const put = await fetch(json.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  async function openFile(id: string) {
    try {
      const res = await fetch(`/api/planner/attachments/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      window.open(json.url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open file");
    }
  }

  async function removeAttachment(id: string) {
    try {
      const res = await fetch(`/api/planner/attachments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove deliverable");
    }
  }

  async function addComment() {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}/feedback${suffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setComment("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post feedback");
    } finally {
      setBusy(false);
    }
  }

  const KIND_ICON = { file: HiOutlinePaperClip, link: HiOutlineLink, text: HiOutlineDocumentText } as const;

  return (
    <div className="space-y-5">
      {error && (
        <p className="text-[11.5px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-lg px-2.5 py-1.5">
          {error}
        </p>
      )}

      {/* ── Deliverables ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-gray-500">
            Deliverables{attachments?.length ? ` (${attachments.length})` : ""}
          </span>
          {canAttach && (
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}
                className="text-[11px] text-indigo-600 hover:text-indigo-800 disabled:opacity-50">File</button>
              <span className="text-gray-300">·</span>
              <button type="button" onClick={() => { setAddKind("link"); setPayload(""); }}
                className="text-[11px] text-indigo-600 hover:text-indigo-800">Link</button>
              <span className="text-gray-300">·</span>
              <button type="button" onClick={() => { setAddKind("text"); setPayload(""); }}
                className="text-[11px] text-indigo-600 hover:text-indigo-800">Note</button>
            </div>
          )}
        </div>

        <input ref={fileInput} type="file" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.target.value = ""; }} />

        {addKind && (
          <div className="mb-2 space-y-1.5 rounded-lg border border-indigo-200 dark:border-indigo-900/50 p-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label"
              className="w-full text-[12px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 outline-none focus:border-indigo-400" />
            <textarea value={payload} onChange={(e) => setPayload(e.target.value)} rows={addKind === "text" ? 3 : 1}
              placeholder={addKind === "link" ? "https://…" : "Write the note…"}
              className="w-full text-[12px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 outline-none focus:border-indigo-400 resize-none" />
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setAddKind(null)}
                className="text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">Cancel</button>
              <button type="button" onClick={addLinkOrText} disabled={busy || !label.trim() || !payload.trim()}
                className="text-[11px] px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-40">Add</button>
            </div>
          </div>
        )}

        {attachments === null ? (
          <p className="text-[11.5px] text-gray-400">Loading…</p>
        ) : attachments.length === 0 ? (
          <p className="text-[11.5px] text-gray-400">No deliverables yet.</p>
        ) : (
          <ul className="space-y-1">
            {attachments.map((a) => {
              const Icon = KIND_ICON[a.kind];
              return (
                <li key={a.id} className="group flex items-start gap-2 rounded-lg border border-gray-200/70 dark:border-gray-800 px-2 py-1.5">
                  <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    {a.kind === "file" ? (
                      <button type="button" onClick={() => openFile(a.id)}
                        className="text-[12px] text-indigo-600 hover:underline text-left break-words">{a.filename}</button>
                    ) : a.kind === "link" ? (
                      <a href={a.link_url ?? "#"} target="_blank" rel="noopener noreferrer"
                        className="text-[12px] text-indigo-600 hover:underline break-words">{a.filename}</a>
                    ) : (
                      <details>
                        <summary className="text-[12px] text-gray-700 dark:text-gray-200 cursor-pointer">{a.filename}</summary>
                        <p className="text-[11.5px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap mt-1">{a.text_body}</p>
                      </details>
                    )}
                    <p className="text-[10px] text-gray-400">
                      {a.uploaded_by} · {when(a.uploaded_at)}{a.size_bytes ? ` · ${sizeLabel(a.size_bytes)}` : ""}
                      {!a.reviewed && <span className="ml-1 text-amber-600">· pending review</span>}
                    </p>
                  </div>
                  {canAttach && (
                    <button type="button" onClick={() => removeAttachment(a.id)} title="Remove"
                      className="opacity-0 group-hover:opacity-100 shrink-0 text-gray-300 hover:text-red-500">
                      <HiOutlineTrash className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Feedback ───────────────────────────────────────────────── */}
      <div>
        <span className="block text-[11px] font-semibold text-gray-500 mb-1.5">
          Feedback{comments?.length ? ` (${comments.length})` : ""}
        </span>

        {comments === null ? (
          <p className="text-[11.5px] text-gray-400">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-[11.5px] text-gray-400 mb-2">No feedback yet.</p>
        ) : (
          <ul className="space-y-2 mb-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-2.5 py-1.5">
                <p className="text-[10px] text-gray-400">{c.author} · {when(c.created_at)}</p>
                <p className="text-[12px] text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
        )}

        <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
          placeholder="Leave feedback…"
          className="w-full text-[12px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2.5 py-1.5 outline-none focus:border-indigo-400 resize-none" />
        <div className="flex justify-end mt-1">
          <button type="button" onClick={addComment} disabled={busy || !comment.trim()}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-indigo-600 text-white disabled:opacity-40">Post</button>
        </div>
      </div>
    </div>
  );
}
