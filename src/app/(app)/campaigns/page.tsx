"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi, apiPost, apiDelete, invalidateCache, uploadDirect } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import {
  HiOutlineChevronRight,
  HiOutlineDocumentText,
  HiOutlineLink,
  HiOutlinePaperClip,
  HiOutlineExternalLink,
  HiCheck,
  HiX,
} from "react-icons/hi";

// ─── Types (mirror the /api/campaigns response) ────────────────────────
type Decision = "go" | "no_go" | "pending";
interface Attachment {
  id: string;
  kind: "file" | "link" | "text";
  file_url: string | null;
  file_name: string | null;
  link_url: string | null;
  text_body: string | null;
  size_bytes: number | null;
  created_at: string;
}
interface Version {
  id: string;
  version_number: number;
  uploaded_by: string;
  uploaded_at: string;
  decision: Decision;
  decided_by: string | null;
  decided_at: string | null;
  feedback: string | null;
  score: number | null;
  attachments: Attachment[];
}
interface Rollup { totalLeaves: number; goLeaves: number; percent: number }
interface ThreadMessage {
  id: string;
  body: string;
  author_email: string;
  author_role: "owner" | "rep" | "admin";
  submission_id: string | null;
  created_at: string;
}
interface Leaf {
  id: string;
  title: string;
  isLeaf: true;
  latestSubmission: Version | null;
  versions: Version[];
  decision: Decision;
  locked: boolean;
  messages: ThreadMessage[];
  latestScore: number | null;
}
interface ItemNode {
  id: string;
  title: string;
  isLeaf: boolean;
  channels?: Leaf[];
  latestSubmission?: Version | null;
  versions?: Version[];
  decision?: Decision;
  locked?: boolean;
  messages?: ThreadMessage[];
  latestScore?: number | null;
  rollup: Rollup;
}
interface Section {
  id: string;
  title: string;
  items: ItemNode[];
  rollup: Rollup;
}
interface Line {
  id: string;
  title: string;
  sections: Section[];
  rollup: Rollup;
}

// ─── Section palette ───────────────────────────────────────────────────
const SECTION_COLORS: Record<string, string> = {
  Branding: "#8B5CF6",
  "Campaign Core": "#EF9F27",
  "Campaign Ops": "#0EA5E9",
  Messaging: "#10B981",
};
const GO_BG = "#EAF3DE";
const GO_TEXT = "#3B6D11";
const GO_BORDER = "#639922";
const NOGO_BG = "#FADCDA";
const NOGO_TEXT = "#A32D2D";
const PENDING_BG = "#FFF4C5";
const PENDING_TEXT = "#854F0B";
const PENDING_BORDER = "#E9A100";
const SCORE_INDIGO_BG = "#EEF1FE";
const SCORE_INDIGO_TEXT = "#4F46E5";

function ScorePill({ score, tone }: { score: number; tone: "go" | "no_go" | "indigo" }) {
  const styles =
    tone === "go"
      ? { background: GO_BG, color: GO_TEXT }
      : tone === "no_go"
      ? { background: NOGO_BG, color: NOGO_TEXT }
      : { background: SCORE_INDIGO_BG, color: SCORE_INDIGO_TEXT };
  return (
    <span
      className="rounded-full"
      style={{
        ...styles,
        fontSize: "10.5px",
        padding: "2px 6px",
        fontWeight: 700,
      }}
    >
      {score}/10
    </span>
  );
}

const LINE_ICONS: Record<string, string> = {
  "Florida CHCs": "🌴",
  "Sebring Execution": "🏢",
};

const LS_KEY = "mimimoenum:campaign-line";

// ─── Progress ring ─────────────────────────────────────────────────────
function Ring({ percent, size = 74, color = "#3B6D11", label }: { percent: number; size?: number; color?: string; label?: string }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  return (
    <div className="flex items-center gap-2">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#E9E7DF" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 300ms ease" }}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="rotate-90 origin-center"
          style={{ transform: "rotate(90deg)", transformOrigin: "center" }}
          fontSize={size * 0.24}
          fontWeight={700}
          fill="#2A2A2A"
        >
          {percent}%
        </text>
      </svg>
      {label && <div className="text-sm text-gray-600 dark:text-gray-400">{label}</div>}
    </div>
  );
}

// ─── Status pill ───────────────────────────────────────────────────────
function StatusPill({ decision, hasSubmission, versionNumber, latestScore }: { decision: Decision; hasSubmission: boolean; versionNumber?: number; latestScore?: number | null }) {
  if (decision === "go") {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-wide" style={{ background: GO_BG, color: GO_TEXT }}>
          GO
        </span>
        {latestScore != null && <ScorePill score={latestScore} tone="indigo" />}
      </span>
    );
  }
  if (!hasSubmission) {
    return (
      <span className="text-[11px] font-medium px-2 py-1 rounded-full uppercase tracking-wide" style={{ background: "#F1EFE8", color: "#5F5E5A" }}>
        AWAITING
      </span>
    );
  }
  if (decision === "no_go") {
    return (
      <span className="text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-wide" style={{ background: NOGO_BG, color: NOGO_TEXT }}>
        NO-GO v{versionNumber}
      </span>
    );
  }
  return (
    <span className="text-[11px] font-bold px-2 py-1 rounded-full uppercase tracking-wide border" style={{ background: PENDING_BG, color: PENDING_TEXT, borderColor: PENDING_BORDER }}>
      v{versionNumber} PENDING
    </span>
  );
}

function StatusSquare({ decision, versionNumber, hasSubmission }: { decision: Decision; versionNumber?: number; hasSubmission: boolean }) {
  if (decision === "go") {
    return (
      <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: GO_BORDER }}>
        <HiCheck className="w-4 h-4 text-white" />
      </div>
    );
  }
  if (!hasSubmission) {
    return <div className="w-6 h-6 rounded border-2 border-gray-300 dark:border-gray-600" />;
  }
  return (
    <div
      className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold border"
      style={{ background: decision === "no_go" ? NOGO_BG : PENDING_BG, color: decision === "no_go" ? NOGO_TEXT : PENDING_TEXT, borderColor: decision === "no_go" ? NOGO_TEXT : PENDING_BORDER }}
    >
      v{versionNumber}
    </div>
  );
}

// ─── Version tape ──────────────────────────────────────────────────────
function VersionTape({ versions }: { versions: Version[] }) {
  if (versions.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {versions.map((v, i) => {
        const bg = v.decision === "go" ? GO_BG : v.decision === "no_go" ? NOGO_BG : PENDING_BG;
        const fg = v.decision === "go" ? GO_TEXT : v.decision === "no_go" ? NOGO_TEXT : PENDING_TEXT;
        const border = v.decision === "pending" ? PENDING_BORDER : "transparent";
        return (
          <div key={v.id} className="flex items-center gap-1">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border" style={{ background: bg, color: fg, borderColor: border }}>
              v{v.version_number} {v.decision === "go" ? "GO" : v.decision === "no_go" ? "NO-GO" : "…"}
            </span>
            {v.score != null && v.decision !== "pending" && (
              <ScorePill score={v.score} tone={v.decision === "go" ? "go" : "no_go"} />
            )}
            {i < versions.length - 1 && <HiOutlineChevronRight className="w-3 h-3 text-gray-400" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Attachment rendering ──────────────────────────────────────────────
function AttachmentRow({ a }: { a: Attachment }) {
  if (a.kind === "file") {
    return (
      <a href={a.file_url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-indigo-600 hover:underline">
        <HiOutlinePaperClip className="w-4 h-4" />
        {a.file_name || "file"}
        {a.size_bytes ? <span className="text-xs text-gray-500">({Math.round(a.size_bytes / 1024)} KB)</span> : null}
      </a>
    );
  }
  if (a.kind === "link") {
    return (
      <a href={a.link_url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-indigo-600 hover:underline">
        <HiOutlineLink className="w-4 h-4" />
        {a.link_url}
        <HiOutlineExternalLink className="w-3 h-3" />
      </a>
    );
  }
  return (
    <div className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
      <HiOutlineDocumentText className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div className="whitespace-pre-wrap">{a.text_body}</div>
    </div>
  );
}

// ─── Upload widget (owner) ─────────────────────────────────────────────
interface PendingAttachment {
  kind: "file" | "link" | "text";
  file_url?: string;
  file_name?: string;
  link_url?: string;
  text_body?: string;
  size_bytes?: number;
}

function UploadPanel({ nodeId, nextVersion, onSaved }: { nodeId: string; nextVersion: number; onSaved: () => void }) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [textBody, setTextBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const up = await uploadDirect(file, "campaigns");
      setItems((prev) => [...prev, { kind: "file", file_url: up.url, file_name: up.name, size_bytes: up.size }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const addLink = () => {
    if (!linkUrl.trim()) return;
    setItems((prev) => [...prev, { kind: "link", link_url: linkUrl.trim() }]);
    setLinkUrl("");
  };

  const addText = () => {
    if (!textBody.trim()) return;
    setItems((prev) => [...prev, { kind: "text", text_body: textBody.trim() }]);
    setTextBody("");
  };

  const removeAt = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (items.length === 0) { setError("Add at least one attachment"); return; }
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/campaigns/submissions", { node_id: nodeId, attachments: items });
      setItems([]);
      invalidateCache("/api/campaigns");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-900/50 p-4">
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Submit v{nextVersion}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
          + File
          <input type="file" className="hidden" onChange={onFile} disabled={busy} />
        </label>

        <div className="flex items-center gap-1">
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://…"
            className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent w-56"
          />
          <button onClick={addLink} className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
            + Link
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <textarea
          value={textBody}
          onChange={(e) => setTextBody(e.target.value)}
          rows={2}
          placeholder="Text note…"
          className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent"
        />
        <button onClick={addText} className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 self-start">
          + Text
        </button>
      </div>

      {items.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Attachments in this version:</div>
          {items.map((a, i) => (
            <div key={i} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1">
              <span>{a.kind === "file" ? a.file_name : a.kind === "link" ? a.link_url : (a.text_body ?? "").slice(0, 60)}</span>
              <button onClick={() => removeAt(i)} className="text-red-500 hover:text-red-700"><HiX className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={busy || items.length === 0}
          className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Submitting…" : `Submit v${nextVersion}`}
        </button>
      </div>
    </div>
  );
}

// ─── Rep panel ─────────────────────────────────────────────────────────
function RepPanel({ submissionId, initialFeedback, initialScore, onDecided }: { submissionId: string; initialFeedback: string | null; initialScore: number | null; onDecided: () => void }) {
  const [feedback, setFeedback] = useState(initialFeedback ?? "");
  const [score, setScore] = useState<number | null>(initialScore ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "go" | "no_go") => {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/campaigns/decisions", { submission_id: submissionId, decision, feedback, score });
      invalidateCache("/api/campaigns");
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-900/50 p-4">
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Rep decision</div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 mr-1">Score out of 10 (optional)</span>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const selected = score === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setScore(selected ? null : n)}
                className="rounded-full text-xs font-semibold w-8 h-8 flex items-center justify-center border transition"
                style={{
                  background: selected ? "#4F46E5" : "#FFFFFF",
                  color: selected ? "#FFFFFF" : "#6B7280",
                  borderColor: selected ? "#4F46E5" : "#D6D3C7",
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
        {score !== null && (
          <button
            type="button"
            onClick={() => setScore(null)}
            className="text-[11px] text-indigo-600 hover:underline ml-auto"
          >
            Clear
          </button>
        )}
      </div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={3}
        placeholder="Feedback (optional for GO, encouraged for NO-GO)"
        className="w-full text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent"
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => decide("no_go")}
          disabled={busy}
          className="text-sm font-semibold px-4 py-2 rounded-lg border-2 disabled:opacity-50"
          style={{ borderColor: NOGO_TEXT, color: NOGO_TEXT }}
        >
          NO-GO
        </button>
        <button
          onClick={() => decide("go")}
          disabled={busy}
          className="text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50"
          style={{ background: GO_BORDER }}
        >
          GO
        </button>
      </div>
    </div>
  );
}

// ─── Thread section ────────────────────────────────────────────────────
const REP_BUBBLE_BG = "#EEF1FE";
const REP_BUBBLE_ACCENT = "#4F46E5";
const OWNER_BUBBLE_BG = "#EAF3DE";
const OWNER_BUBBLE_ACCENT = "#3B6D11";

function versionOf(msg: ThreadMessage, versions: Version[]): number | null {
  if (!msg.submission_id) return null;
  const v = versions.find((x) => x.id === msg.submission_id);
  return v ? v.version_number : null;
}

function ThreadBubble({
  msg,
  versions,
  canDelete,
  onDeleted,
}: {
  msg: ThreadMessage;
  versions: Version[];
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const isRep = msg.author_role === "rep";
  const bg = isRep ? REP_BUBBLE_BG : OWNER_BUBBLE_BG;
  const accent = isRep ? REP_BUBBLE_ACCENT : OWNER_BUBBLE_ACCENT;
  const roleLabel = msg.author_role === "rep" ? "REP" : msg.author_role === "admin" ? "ADMIN" : "OWNER";
  const ver = versionOf(msg, versions);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const handleDelete = async () => {
    if (!confirm) { setConfirm(true); return; }
    setDeleting(true);
    try {
      await apiDelete(`/api/campaigns/messages/${msg.id}`);
      invalidateCache("/api/campaigns");
      onDeleted();
    } catch {
      setDeleting(false);
      setConfirm(false);
    }
  };
  return (
    <div className={`flex ${isRep ? "justify-start" : "justify-end"}`}>
      <div
        className="max-w-[85%] rounded-2xl px-3 py-2 border"
        style={{ background: bg, borderColor: accent + "33" }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold" style={{ color: accent }}>
            {msg.author_email}
          </span>
          <span
            className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
            style={{ background: accent, color: "#fff" }}
          >
            {roleLabel}
          </span>
          {ver !== null && (
            <span
              className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border"
              style={{ color: accent, borderColor: accent + "66" }}
            >
              v{ver} feedback
            </span>
          )}
          <span className="text-[10px] text-gray-500 ml-auto">
            {new Date(msg.created_at).toLocaleString()}
          </span>
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              title={confirm ? "Click again to confirm" : "Delete message"}
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              {deleting ? "…" : confirm ? "Confirm?" : "Delete"}
            </button>
          )}
        </div>
        <div className="mt-1 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
          {msg.body}
        </div>
      </div>
    </div>
  );
}

function ThreadSection({ nodeId, messages, versions, onPosted }: { nodeId: string; messages: ThreadMessage[]; versions: Version[]; onPosted: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { dbUser, appRole } = useAuth();
  const myEmail = dbUser?.email ?? null;

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/campaigns/messages", { node_id: nodeId, body: text.trim() });
      setText("");
      invalidateCache("/api/campaigns");
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-900/50 p-4">
      <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">
        Thread · {messages.length} message{messages.length === 1 ? "" : "s"}
      </div>
      {messages.length > 0 && (
        <div className="space-y-2">
          {messages.map((m) => (
            <ThreadBubble
              key={m.id}
              msg={m}
              versions={versions}
              canDelete={appRole === "admin" || (!!myEmail && myEmail === m.author_email)}
              onDeleted={onPosted}
            />
          ))}
        </div>
      )}
      <div className="pt-1 flex flex-col gap-1">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Write a message…"
          className="w-full text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent"
        />
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="flex justify-end">
          <button
            onClick={send}
            disabled={busy || !text.trim()}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Leaf row ──────────────────────────────────────────────────────────
function LeafRow({ leaf, indent, isOwner, isRep, onChanged }: { leaf: Leaf; indent: number; isOwner: boolean; isRep: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const decision = leaf.decision;
  const latest = leaf.latestSubmission;
  const versionNumber = latest?.version_number;
  const hasSubmission = !!latest;

  const nextVersion = (latest?.version_number ?? 0) + 1;
  const showUpload = isOwner && !leaf.locked;
  const showRep = isRep && latest && latest.decision === "pending";

  return (
    <div className="border-b border-gray-100 dark:border-gray-800/70 last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 rounded-lg px-2 transition"
        style={{ paddingLeft: `${indent * 20 + 8}px` }}
      >
        <StatusSquare decision={decision} versionNumber={versionNumber} hasSubmission={hasSubmission} />
        <span
          className={`text-sm flex-1 text-left ${decision === "go" ? "line-through text-gray-500" : "text-gray-800 dark:text-gray-200"}`}
        >
          {leaf.title}
        </span>
        <StatusPill decision={decision} hasSubmission={hasSubmission} versionNumber={versionNumber} latestScore={leaf.latestScore} />
        <HiOutlineChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="pb-3" style={{ paddingLeft: `${indent * 20 + 40}px`, paddingRight: 16 }}>
          {leaf.versions.length > 0 && (
            <div className="mt-2">
              <VersionTape versions={leaf.versions} />
            </div>
          )}

          {latest && (
            <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/40 p-3 space-y-2">
              <div className="text-xs text-gray-500">
                v{latest.version_number} by {latest.uploaded_by} · {new Date(latest.uploaded_at).toLocaleString()}
              </div>
              {latest.attachments.map((a) => (
                <AttachmentRow key={a.id} a={a} />
              ))}
              {latest.feedback && (
                <div className="mt-2 text-xs italic border-l-2 pl-2 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                  Rep: {latest.feedback}
                </div>
              )}
            </div>
          )}

          {showUpload && <UploadPanel nodeId={leaf.id} nextVersion={nextVersion} onSaved={onChanged} />}

          <ThreadSection
            nodeId={leaf.id}
            messages={leaf.messages}
            versions={leaf.versions}
            onPosted={onChanged}
          />

          {showRep && latest && <RepPanel submissionId={latest.id} initialFeedback={latest.feedback} initialScore={latest.score} onDecided={onChanged} />}
          {leaf.locked && (
            <div className="mt-2 text-xs text-green-700 font-semibold">Locked — this leaf is GO.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Item row (may have channels) ──────────────────────────────────────
function ItemRow({ item, indent, isOwner, isRep, onChanged }: { item: ItemNode; indent: number; isOwner: boolean; isRep: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);

  if (item.isLeaf) {
    // Item is itself a leaf (no channels)
    const asLeaf: Leaf = {
      id: item.id,
      title: item.title,
      isLeaf: true,
      latestSubmission: item.latestSubmission ?? null,
      versions: item.versions ?? [],
      decision: item.decision ?? "pending",
      locked: !!item.locked,
      messages: item.messages ?? [],
      latestScore: item.latestScore ?? null,
    };
    return <LeafRow leaf={asLeaf} indent={indent} isOwner={isOwner} isRep={isRep} onChanged={onChanged} />;
  }

  const { totalLeaves, goLeaves, percent } = item.rollup;
  const allGo = totalLeaves > 0 && goLeaves === totalLeaves;

  return (
    <div className="border-b border-gray-100 dark:border-gray-800/70 last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 rounded-lg px-2 transition"
        style={{ paddingLeft: `${indent * 20 + 8}px` }}
      >
        <HiOutlineChevronRight className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`} />
        <span className={`text-sm flex-1 text-left font-medium ${allGo ? "line-through text-gray-500" : "text-gray-800 dark:text-gray-200"}`}>
          {item.title}
        </span>
        <span
          className="text-[11px] font-bold px-2 py-1 rounded-full"
          style={{
            background: allGo ? GO_BG : "#F1EFE8",
            color: allGo ? GO_TEXT : "#5F5E5A",
          }}
        >
          {goLeaves}/{totalLeaves}
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums w-8 text-right">{percent}%</span>
      </button>

      {open && item.channels && (
        <div>
          {item.channels.map((ch) => (
            <LeafRow key={ch.id} leaf={ch} indent={indent + 1} isOwner={isOwner} isRep={isRep} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section block ─────────────────────────────────────────────────────
function SectionBlock({ section, isOwner, isRep, onChanged }: { section: Section; isOwner: boolean; isRep: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(true);
  const color = SECTION_COLORS[section.title] ?? "#8B5CF6";
  const { totalLeaves, goLeaves } = section.rollup;

  return (
    <div className="relative rounded-2xl bg-white dark:bg-gray-900/60 shadow-sm border border-gray-200/70 dark:border-gray-800/70 overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0" style={{ width: 6, background: color }} />
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 pl-6 pr-4 py-4 hover:bg-gray-50/70 dark:hover:bg-gray-800/30 transition"
      >
        <span className="text-base font-bold flex-1 text-left" style={{ color }}>
          {section.title}
        </span>
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
          {goLeaves} of {totalLeaves} leaves at GO
        </span>
        <HiOutlineChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="pl-6 pr-2 pb-2">
          {section.items.map((it) => (
            <ItemRow key={it.id} item={it} indent={0} isOwner={isOwner} isRep={isRep} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────
export default function CampaignsPage() {
  const { appRole } = useAuth();
  const { data, loading, error, refetch } = useApi<Line[]>("/api/campaigns");
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

  const isOwner = appRole === "doer" || appRole === "admin";
  const isRep = appRole === "assessor";

  // Restore stored line choice once data arrives.
  useEffect(() => {
    if (!data || data.length === 0) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(LS_KEY); } catch {}
    const match = stored && data.find((l) => l.id === stored);
    setActiveLineId(match ? match.id : data[0].id);
  }, [data]);

  const activeLine = useMemo(() => data?.find((l) => l.id === activeLineId) ?? null, [data, activeLineId]);

  const chooseLine = (id: string) => {
    setActiveLineId(id);
    try { localStorage.setItem(LS_KEY, id); } catch {}
  };

  if (loading) {
    return <div className="p-8 text-sm text-gray-500">Loading campaigns…</div>;
  }
  if (error) {
    return <div className="p-8 text-sm text-red-600">Error: {error}</div>;
  }
  if (!data || data.length === 0) {
    return <div className="p-8 text-sm text-gray-500">No campaigns yet.</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Campaign Checklist</h1>
          <p className="text-sm text-gray-500 mt-1">Preparedness across both campaign lines.</p>
        </div>
        <div className="flex items-center gap-6">
          {data.map((line) => (
            <div key={line.id} className="flex items-center gap-2">
              <Ring
                percent={line.rollup.percent}
                color={line.id === activeLineId ? "#4F46E5" : "#94A3B8"}
              />
              <div className="text-xs text-gray-600 dark:text-gray-400">
                <div className="font-semibold">{line.title}</div>
                <div>{line.rollup.goLeaves} / {line.rollup.totalLeaves} leaves</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Line switch */}
      <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-full p-1">
        {data.map((line) => {
          const active = line.id === activeLineId;
          return (
            <button
              key={line.id}
              onClick={() => chooseLine(line.id)}
              className={`text-sm px-4 py-2 rounded-full font-semibold transition ${
                active ? "bg-white dark:bg-gray-950 text-gray-900 dark:text-white shadow" : "text-gray-600 dark:text-gray-400"
              }`}
            >
              <span className="mr-1">{LINE_ICONS[line.title] ?? ""}</span>
              {line.title}
            </button>
          );
        })}
      </div>

      {/* Sections */}
      {activeLine && (
        <div className="space-y-4">
          {activeLine.sections.map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              isOwner={isOwner}
              isRep={isRep}
              onChanged={refetch}
            />
          ))}
        </div>
      )}
    </div>
  );
}
