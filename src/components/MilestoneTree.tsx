"use client";

import { useMemo, useState, useRef } from "react";
import { useApi, apiPost, apiPatch, apiDelete, invalidateCache } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { useToast, SkeletonRows } from "@/components/ui";
import { handleApiError } from "@/lib/utils";
import { HiChevronDown, HiChevronRight, HiPlus, HiOutlineChatAlt, HiOutlinePaperClip, HiOutlineTrash, HiOutlineDownload, HiX } from "react-icons/hi";

type Kind = "Milestone" | "Goal" | "Sub-goal" | "Task";
type Node = {
  id: string;
  parent_id: string | null;
  owner_id: string;
  title: string;
  kind: Kind;
  assignee: string | null;
  score: number | null;
  sort_order: number;
  collapsed: boolean;
  created_at: string;
  updated_at: string;
  owner?: { id: string; full_name: string };
  feedback_count: number;
  attachment_count: number;
};

type Feedback = { id: string; author: string; body: string; created_at: string };
type Attachment = { id: string; filename: string; content_type: string | null; size_bytes: number | null; uploaded_by: string; uploaded_at: string };

const KINDS: Kind[] = ["Milestone", "Goal", "Sub-goal", "Task"];
const KIND_COLOR: Record<Kind, string> = {
  Milestone: "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800/40",
  Goal: "text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/40",
  "Sub-goal": "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/40",
  Task: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40",
};

export default function MilestoneTree() {
  const { data: nodes, loading, refetch } = useApi<Node[]>("/api/milestone-nodes");
  const { dbUser, appRole } = useAuth();
  const { toast } = useToast();
  const isDoer = appRole === "doer" || appRole === "admin";

  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null; kind: Kind } | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const roots = useMemo(() => (nodes || []).filter((n) => !n.parent_id).sort(byOrder), [nodes]);
  const childrenMap = useMemo(() => {
    const m = new Map<string, Node[]>();
    for (const n of nodes || []) {
      if (!n.parent_id) continue;
      if (!m.has(n.parent_id)) m.set(n.parent_id, []);
      m.get(n.parent_id)!.push(n);
    }
    for (const arr of m.values()) arr.sort(byOrder);
    return m;
  }, [nodes]);

  const openNode = (nodes || []).find((n) => n.id === openNodeId) || null;

  async function createNode(parentId: string | null, kind: Kind, title: string) {
    if (!title.trim()) return;
    try {
      const siblings = parentId ? childrenMap.get(parentId) || [] : roots;
      const sort_order = siblings.length;
      await apiPost("/api/milestone-nodes", { parent_id: parentId, kind, title: title.trim(), sort_order });
      setCreating(null);
      setNewTitle("");
      invalidateCache("/api/milestone-nodes");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function updateNode(id: string, patch: Partial<Node>) {
    try {
      await apiPatch(`/api/milestone-nodes/${id}`, patch);
      invalidateCache("/api/milestone-nodes");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function deleteNode(id: string) {
    if (!confirm("Delete this node and all its children (including attachments)?")) return;
    try {
      await apiDelete(`/api/milestone-nodes/${id}`);
      if (openNodeId === id) setOpenNodeId(null);
      invalidateCache("/api/milestone-nodes");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  if (loading) return <div className="mt-6"><SkeletonRows count={6} /></div>;

  return (
    <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
      {/* Tree */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-4 space-y-1 min-h-[300px]">
        {roots.length === 0 && !creating && (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 mb-3">No milestones yet. Start by creating one.</p>
            {isDoer && (
              <button onClick={() => setCreating({ parentId: null, kind: "Milestone" })}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm rounded-xl shadow-md hover:brightness-110 transition-all">
                <HiPlus className="w-4 h-4" /> Create first milestone
              </button>
            )}
          </div>
        )}

        {roots.map((n) => (
          <TreeRow key={n.id} node={n} depth={0} childrenMap={childrenMap}
            selectedId={openNodeId} onSelect={setOpenNodeId}
            onCreate={(parentId, kind) => { setCreating({ parentId, kind }); setNewTitle(""); }}
            onDelete={deleteNode} onUpdate={updateNode}
            isDoer={isDoer}
          />
        ))}

        {isDoer && roots.length > 0 && !creating && (
          <button onClick={() => setCreating({ parentId: null, kind: "Milestone" })}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-indigo-600 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 rounded-lg transition-all">
            <HiPlus className="w-3.5 h-3.5" /> Add Milestone
          </button>
        )}

        {creating && (
          <div className="mt-3 p-3 bg-indigo-50/40 dark:bg-indigo-900/10 border border-indigo-200/60 dark:border-indigo-800/30 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-semibold ${KIND_COLOR[creating.kind]}`}>{creating.kind}</span>
              <select value={creating.kind} onChange={(e) => setCreating({ ...creating, kind: e.target.value as Kind })}
                className="text-xs bg-white/70 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 rounded-md px-1.5 py-0.5">
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <input
              autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createNode(creating.parentId, creating.kind, newTitle);
                if (e.key === "Escape") { setCreating(null); setNewTitle(""); }
              }}
              placeholder={`New ${creating.kind} title…`}
              className="w-full px-3 py-1.5 text-sm bg-white/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={() => createNode(creating.parentId, creating.kind, newTitle)} disabled={!newTitle.trim()}
                className="px-3 py-1 text-xs bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white rounded-md transition-all">Create</button>
              <button onClick={() => { setCreating(null); setNewTitle(""); }} className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Right panel: node details */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-4 min-h-[300px]">
        {openNode ? (
          <NodeDetailPanel key={openNode.id} node={openNode} onClose={() => setOpenNodeId(null)}
            currentUser={dbUser} isDoer={isDoer}
            onUpdate={updateNode} onRefetch={refetch}
          />
        ) : (
          <div className="text-center py-12">
            <HiOutlineChatAlt className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">Select a node to see feedback and attachments.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function byOrder(a: Node, b: Node) {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

function TreeRow({
  node, depth, childrenMap, selectedId, onSelect, onCreate, onDelete, onUpdate, isDoer,
}: {
  node: Node; depth: number; childrenMap: Map<string, Node[]>;
  selectedId: string | null; onSelect: (id: string) => void;
  onCreate: (parentId: string, kind: Kind) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Node>) => void;
  isDoer: boolean;
}) {
  const children = childrenMap.get(node.id) || [];
  const hasChildren = children.length > 0;
  const isSelected = selectedId === node.id;
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.title);

  async function toggle() {
    onUpdate(node.id, { collapsed: !node.collapsed });
  }

  async function saveTitle() {
    if (editTitle.trim() && editTitle !== node.title) {
      await onUpdate(node.id, { title: editTitle.trim() });
    }
    setEditing(false);
  }

  // Default next kind when adding a child
  const nextKind: Kind = node.kind === "Milestone" ? "Goal" : node.kind === "Goal" ? "Sub-goal" : "Task";

  return (
    <>
      <div
        className={`group flex items-center gap-1.5 py-1.5 pr-2 rounded-lg transition-all cursor-pointer ${
          isSelected ? "bg-indigo-50/60 dark:bg-indigo-900/15 ring-1 ring-indigo-200 dark:ring-indigo-800/40" : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        <button onClick={(e) => { e.stopPropagation(); if (hasChildren) toggle(); }}
          className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors">
          {hasChildren ? (node.collapsed ? <HiChevronRight className="w-3.5 h-3.5" /> : <HiChevronDown className="w-3.5 h-3.5" />) : <span className="w-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700" />}
        </button>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-semibold ${KIND_COLOR[node.kind]}`}>{node.kind}</span>
        {editing ? (
          <input
            autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle();
              if (e.key === "Escape") { setEditing(false); setEditTitle(node.title); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 px-2 py-0.5 text-sm bg-white dark:bg-gray-900 border border-indigo-300 rounded-md focus:outline-none"
          />
        ) : (
          <span
            onDoubleClick={(e) => { if (!isDoer) return; e.stopPropagation(); setEditing(true); setEditTitle(node.title); }}
            className="text-sm text-gray-800 dark:text-gray-200 truncate flex-1 min-w-0"
            title={isDoer ? "Double-click to rename" : node.title}
          >
            {node.title}
          </span>
        )}
        {node.assignee && <span className="text-[10px] text-gray-500 flex-shrink-0">· {node.assignee}</span>}
        {node.score != null && <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 flex-shrink-0">{node.score}/10</span>}
        {node.feedback_count > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-violet-500 flex-shrink-0">
            <HiOutlineChatAlt className="w-3 h-3" />{node.feedback_count}
          </span>
        )}
        {node.attachment_count > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-blue-500 flex-shrink-0">
            <HiOutlinePaperClip className="w-3 h-3" />{node.attachment_count}
          </span>
        )}
        {isDoer && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button onClick={(e) => { e.stopPropagation(); onCreate(node.id, nextKind); }}
              title={`Add ${nextKind}`}
              className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded transition-all">
              <HiPlus className="w-3.5 h-3.5" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
              title="Delete node"
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all">
              <HiOutlineTrash className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      {!node.collapsed && children.map((c) => (
        <TreeRow key={c.id} node={c} depth={depth + 1} childrenMap={childrenMap}
          selectedId={selectedId} onSelect={onSelect} onCreate={onCreate} onDelete={onDelete} onUpdate={onUpdate} isDoer={isDoer} />
      ))}
    </>
  );
}

function NodeDetailPanel({
  node, onClose, currentUser, isDoer, onUpdate, onRefetch,
}: {
  node: Node;
  onClose: () => void;
  currentUser: { id: string; full_name: string; email: string } | null;
  isDoer: boolean;
  onUpdate: (id: string, patch: Partial<Node>) => void;
  onRefetch: () => Promise<unknown>;
}) {
  const { toast } = useToast();
  const { data: feedback, refetch: refetchFeedback } = useApi<Feedback[]>(`/api/milestone-nodes/${node.id}/feedback`);
  const { data: attachments, refetch: refetchAttachments } = useApi<Attachment[]>(`/api/milestone-nodes/${node.id}/attachments`);
  const [fbBody, setFbBody] = useState("");
  const [assigneeEdit, setAssigneeEdit] = useState(node.assignee || "");
  const [scoreEdit, setScoreEdit] = useState<number | "">(node.score ?? "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submitFeedback() {
    if (!fbBody.trim()) return;
    try {
      await apiPost(`/api/milestone-nodes/${node.id}/feedback`, {
        author: currentUser?.full_name || "Unknown",
        body: fbBody.trim(),
      });
      setFbBody("");
      await refetchFeedback();
      await onRefetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      // Step 1: ask API for a signed upload URL
      const signed = (await apiPost(
        `/api/milestone-nodes/${node.id}/attachments`,
        { filename: file.name, content_type: file.type, size_bytes: file.size },
      )) as { upload_url: string; token: string; attachment_id: string };
      // Step 2: PUT the file to Supabase Storage
      const res = await fetch(signed.upload_url, { method: "PUT", body: file, headers: file.type ? { "Content-Type": file.type } : {} });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      await refetchAttachments();
      await onRefetch();
      toast("File uploaded", "success");
    } catch (e) {
      toast(handleApiError(e), "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function download(attId: string) {
    try {
      const { url } = await (await fetch(`/api/milestone-nodes/attachments/${attId}/url`)).json();
      if (!url) throw new Error("Could not generate download link");
      window.open(url, "_blank");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function deleteAttachment(attId: string) {
    if (!confirm("Delete this file? This can't be undone.")) return;
    try {
      await apiDelete(`/api/milestone-nodes/attachments/${attId}`);
      await refetchAttachments();
      await onRefetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function saveScore() {
    const v = scoreEdit === "" ? null : Number(scoreEdit);
    if (v != null && (isNaN(v) || v < 1 || v > 10)) { toast("Score must be 1-10", "error"); return; }
    await onUpdate(node.id, { score: v });
  }

  async function saveAssignee() {
    await onUpdate(node.id, { assignee: assigneeEdit.trim() || null });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-semibold ${KIND_COLOR[node.kind]}`}>{node.kind}</span>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mt-1 truncate">{node.title}</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">Created by {node.owner?.full_name || "—"}</p>
        </div>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded"><HiX className="w-4 h-4" /></button>
      </div>

      {/* Meta */}
      {isDoer && (
        <div className="grid grid-cols-2 gap-2 pb-3 border-b border-gray-200 dark:border-gray-800">
          <div>
            <label className="text-[10px] text-gray-500 mb-0.5 block">Assignee</label>
            <input value={assigneeEdit} onChange={(e) => setAssigneeEdit(e.target.value)} onBlur={saveAssignee}
              placeholder="Name" className="w-full px-2 py-1 text-xs bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500/40" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 mb-0.5 block">Score (1-10)</label>
            <input type="number" min={1} max={10} value={scoreEdit} onChange={(e) => setScoreEdit(e.target.value === "" ? "" : Number(e.target.value))} onBlur={saveScore}
              className="w-full px-2 py-1 text-xs bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500/40" />
          </div>
        </div>
      )}

      {/* Attachments */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Attachments ({attachments?.length || 0})</p>
          <label className="cursor-pointer text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
            <HiOutlinePaperClip className="w-3.5 h-3.5" />
            {uploading ? "Uploading…" : "Upload"}
            <input ref={fileRef} type="file" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
              disabled={uploading} />
          </label>
        </div>
        {(attachments || []).length === 0 ? (
          <p className="text-xs text-gray-400 italic">No files attached.</p>
        ) : (
          <ul className="space-y-1">
            {(attachments || []).map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/40 group">
                <HiOutlinePaperClip className="w-3 h-3 text-blue-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 dark:text-gray-300 truncate">{a.filename}</p>
                  <p className="text-[9px] text-gray-400">{a.uploaded_by} · {formatShort(a.uploaded_at)}{a.size_bytes ? ` · ${humanBytes(a.size_bytes)}` : ""}</p>
                </div>
                <button onClick={() => download(a.id)} title="Download"
                  className="p-1 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-all">
                  <HiOutlineDownload className="w-3.5 h-3.5" />
                </button>
                {isDoer && (
                  <button onClick={() => deleteAttachment(a.id)} title="Delete file"
                    className="p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all">
                    <HiOutlineTrash className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Feedback */}
      <div>
        <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">Feedback ({feedback?.length || 0})</p>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {(feedback || []).length === 0 && <p className="text-xs text-gray-400 italic">No feedback yet.</p>}
          {(feedback || []).map((f) => (
            <div key={f.id} className="bg-gray-50/70 dark:bg-gray-800/40 rounded-lg p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{f.author}</span>
                <span className="text-[9px] text-gray-400">{formatShort(f.created_at)}</span>
              </div>
              <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input value={fbBody} onChange={(e) => setFbBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitFeedback(); }}
            placeholder="Add feedback…"
            className="flex-1 px-3 py-1.5 text-xs bg-white/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
          <button onClick={submitFeedback} disabled={!fbBody.trim()}
            className="px-3 py-1.5 text-xs bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white rounded-lg transition-all">Post</button>
        </div>
      </div>
    </div>
  );
}

function humanBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatShort(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
