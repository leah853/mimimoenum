"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Task, TaskStatus, Subtask, Deliverable, Feedback } from "@/lib/types";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import { useApi, apiPatch, apiPost, apiUpload, apiDelete } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { canEditTasks, canCreateTasks, canUploadDeliverables, canDeleteTasks, canGiveFeedback, canEditFeedback, canDeleteFeedback, canDeleteDeliverables } from "@/lib/roles";
import { getCompletionBlockers } from "@/lib/business-rules";
import { HiArrowLeft, HiExclamationCircle, HiTrash, HiReply, HiPencil, HiCheck, HiX, HiEye } from "react-icons/hi";

type FeedbackItem = Feedback & { reviewer?: { id: string; full_name: string }; acknowledged?: boolean; acknowledged_by?: string; acknowledged_at?: string };
type FullTask = Task & {
  owner?: { id: string; full_name: string; email: string };
  subtasks?: Subtask[];
  deliverables?: Deliverable[];
  feedback?: FeedbackItem[];
  deps_from?: { id: string; depends_on_task_id: string; depends_on?: { id: string; title: string; status: TaskStatus; category?: string } }[];
  deps_to?: { id: string; task_id: string; task?: { id: string; title: string; status: TaskStatus; category?: string } }[];
};
type OwnerOption = { id: string; full_name: string; email: string };

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { dbUser, appRole } = useAuth();
  const { data: task, loading, refetch } = useApi<FullTask>(id ? `/api/tasks/${id}` : null);
  const { data: owners } = useApi<OwnerOption[]>("/api/users/owners");
  const { data: allTasks } = useApi<{ id: string; title: string; category: string; status: TaskStatus }[]>("/api/tasks");

  const [activeTab, setActiveTab] = useState<"details" | "feedback">("details");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", status: "not_started" as TaskStatus, deadline: "", owner_id: "" });
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [showSubForm, setShowSubForm] = useState(false);
  const [fileTitle, setFileTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fbRating, setFbRating] = useState(5);
  const [fbComment, setFbComment] = useState("");
  const [fbTag, setFbTag] = useState("approved");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editingFb, setEditingFb] = useState<string | null>(null);
  const [editFbComment, setEditFbComment] = useState("");
  const [editFbRating, setEditFbRating] = useState(5);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDepAdd, setShowDepAdd] = useState<"prerequisite" | "dependency" | null>(null);
  const [depTaskId, setDepTaskId] = useState("");
  const [error, setError] = useState("");

  if (loading) return <div className="p-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500" /></div>;
  if (!task) return <div className="p-8 animate-fade-in"><button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 mb-4"><HiArrowLeft className="w-4 h-4" /> Back</button><p className="text-gray-500">Task not found</p></div>;

  const isDoer = canEditTasks(appRole);
  const isAssessor = canGiveFeedback(appRole);
  const hasFeedback = (task.feedback?.length || 0) > 0;
  const isLocked = hasFeedback; // Once feedback given, task/deliverables locked
  const canModifyTask = isDoer && !isLocked;

  async function startEdit() {
    setForm({ title: task!.title, description: task!.description || "", status: task!.status, deadline: task!.deadline || "", owner_id: task!.owner_id || "" });
    setEditing(true); setError("");
  }
  async function saveEdit() {
    setSaving(true); setError("");
    try { await apiPatch(`/api/tasks/${id}`, form); await refetch(); setEditing(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    setSaving(false);
  }
  async function deleteTask() {
    if (!confirm("Delete this task permanently?")) return;
    setDeleting(true);
    try { await apiDelete(`/api/tasks/${id}`); router.push("/tasks"); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); setDeleting(false); }
  }
  async function addSubtask() {
    if (!subtaskTitle) return;
    try { await apiPost("/api/subtasks", { task_id: id, title: subtaskTitle }); setSubtaskTitle(""); setShowSubForm(false); await refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }
  async function uploadFile() {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("task_id", id); fd.append("title", fileTitle || file.name);
      if (dbUser) fd.append("uploaded_by", dbUser.id);
      await apiUpload("/api/deliverables", fd); setFile(null); setFileTitle(""); await refetch();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    setUploading(false);
  }
  async function deleteDeliverable(delId: string) {
    if (!confirm("Delete this file?")) return;
    try { await apiDelete(`/api/deliverables/${delId}`); await refetch(); } catch {}
  }
  async function submitFeedback() {
    if (!dbUser) return;
    try { await apiPost("/api/feedback", { task_id: id, reviewer_id: dbUser.id, rating: fbRating, comment: fbComment || null, tag: fbTag }); setFbComment(""); setFbRating(5); await refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }
  async function updateFeedback(fbId: string) {
    try { await apiPatch(`/api/feedback/${fbId}`, { comment: editFbComment, rating: editFbRating }); setEditingFb(null); await refetch(); } catch {}
  }
  async function deleteFeedback(fbId: string) {
    if (!confirm("Delete this feedback?")) return;
    try { await apiDelete(`/api/feedback/${fbId}`); await refetch(); } catch {}
  }
  async function replyToFeedback() {
    if (!dbUser || !replyText || !replyTo) return;
    const orig = task!.feedback?.find(f => f.id === replyTo);
    try {
      await apiPost("/api/feedback", { task_id: id, reviewer_id: dbUser.id, rating: orig?.rating || 5, comment: `↩️ Reply to ${orig?.reviewer?.full_name}: ${replyText}`, tag: "approved" });
      setReplyTo(null); setReplyText(""); await refetch();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }
  async function addDependency() {
    if (!depTaskId) return;
    try {
      if (showDepAdd === "prerequisite") await apiPost("/api/dependencies", { task_id: depTaskId, depends_on_task_id: id });
      else await apiPost("/api/dependencies", { task_id: id, depends_on_task_id: depTaskId });
      setShowDepAdd(null); setDepTaskId(""); await refetch();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }
  async function removeDependency(depId: string) {
    try { await apiDelete(`/api/dependencies?id=${depId}`); await refetch(); } catch {}
  }

  const feedbackList = task.feedback || [];
  const categories = [...new Set((allTasks || []).map(t => t.category).filter(Boolean))];

  const tagColors: Record<string, string> = {
    approved: "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400",
    needs_improvement: "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400",
    blocked: "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400",
  };

  return (
    <div className="p-8 max-w-5xl space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"><HiArrowLeft className="w-4 h-4" /> Back</button>
        {canDeleteTasks(appRole) && (
          <button onClick={deleteTask} disabled={deleting} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-500 hover:text-white hover:bg-red-500 border border-red-200 dark:border-red-800/30 rounded-xl transition-all">
            <HiTrash className="w-3.5 h-3.5" /> {deleting ? "Deleting..." : "Delete"}
          </button>
        )}
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200/60 dark:border-red-800/40 rounded-xl px-4 py-2.5 text-sm text-red-600 dark:text-red-400 animate-fade-in">{error}</div>}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1 mr-4">
          {editing ? (
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="text-2xl font-bold bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-1 text-gray-900 dark:text-white w-full" />
          ) : (
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{task.title}</h1>
          )}
          {task.category && <span className="text-xs px-2.5 py-1 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 text-indigo-600 dark:text-indigo-400 rounded-full">{task.category}</span>}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[task.status] + "18", color: STATUS_COLORS[task.status] }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[task.status] }} />{STATUS_LABELS[task.status]}
          </span>
          {canModifyTask && !editing && <button onClick={startEdit} className="px-3 py-1.5 bg-gradient-to-r from-gray-100 to-gray-50 dark:from-gray-800 dark:to-gray-700 text-gray-700 dark:text-gray-300 text-sm rounded-xl hover:brightness-105 transition-all">Edit</button>}
          {editing && (
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={saving} className="px-3 py-1.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:brightness-110 text-white text-sm rounded-xl shadow-sm transition-all active:scale-[0.97]">{saving ? "Saving..." : "Save"}</button>
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-gray-500 text-sm">Cancel</button>
            </div>
          )}
        </div>
      </div>

      {/* Role + lock indicator */}
      {appRole === "assessor" && (
        <div className="bg-violet-50 dark:bg-violet-900/10 border border-violet-200/60 dark:border-violet-800/30 rounded-xl px-4 py-2 text-xs text-violet-700 dark:text-violet-400">
          👁️ You are viewing as <strong>Rep</strong> — you can review and provide feedback but cannot edit task details.
        </div>
      )}
      {isLocked && isDoer && (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200/60 dark:border-amber-800/30 rounded-xl px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          🔒 This task has received feedback — editing, deleting, and file changes are locked.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {(["details", "feedback"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-all capitalize ${activeTab === tab ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {tab === "details" ? "Details" : `Feedback Trail (${feedbackList.length})`}
          </button>
        ))}
      </div>

      {/* ===== DETAILS TAB ===== */}
      {activeTab === "details" && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-6">
            {/* Description */}
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-6">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Description</h3>
              {editing ? (
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" placeholder="Add description..." />
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-300">{task.description || "No description"}</p>
              )}
            </div>

            {/* Edit fields — doers only */}
            {editing && isDoer && (() => {
              const blockers = getCompletionBlockers(task as Task & { deliverables?: { id: string }[]; feedback?: { id: string }[] });
              const blocked = blockers.length > 0;
              return (
                <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-6 space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div><label className="text-xs text-gray-500 mb-1 block">Status</label>
                      <select value={form.status} onChange={(e) => { const v = e.target.value as TaskStatus; if (v === "completed" && blocked) { setError(`Cannot complete: ${blockers.join(". ")}`); return; } setForm({ ...form, status: v }); }}
                        className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white">
                        {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k} disabled={k === "completed" && blocked}>{l}</option>)}
                      </select></div>
                    <div><label className="text-xs text-gray-500 mb-1 block">Deadline</label>
                      <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" /></div>
                    <div><label className="text-xs text-gray-500 mb-1 block">Owner</label>
                      <select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })} className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white">
                        <option value="">Unassigned</option>{(owners || []).map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                      </select></div>
                  </div>
                  {blocked && <div className="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200/60 dark:border-yellow-800/30 rounded-xl px-3 py-2"><HiExclamationCircle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" /><div>{blockers.map((b, i) => <p key={i} className="text-xs text-yellow-600 dark:text-yellow-500">• {b}</p>)}</div></div>}
                </div>
              );
            })()}

            {/* Subtasks — doers can add */}
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Subtasks ({task.subtasks?.length || 0})</h3>
                {isDoer && <button onClick={() => setShowSubForm(!showSubForm)} className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors">+ Add</button>}
              </div>
              {showSubForm && isDoer && (
                <div className="flex gap-2"><input value={subtaskTitle} onChange={(e) => setSubtaskTitle(e.target.value)} placeholder="Subtask title" className="flex-1 px-4 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" onKeyDown={(e) => e.key === "Enter" && addSubtask()} /><button onClick={addSubtask} className="px-3 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm rounded-xl shadow-sm">Add</button></div>
              )}
              {(task.subtasks || []).map((st) => (
                <div key={st.id} className="flex items-center justify-between bg-gray-50/80 dark:bg-gray-800/40 rounded-xl px-4 py-3"><div className="flex items-center gap-3"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[st.status] }} /><span className="text-sm text-gray-800 dark:text-white">{st.title}</span></div>
                  {isDoer && <select value={st.status} onChange={(e) => apiPost("/api/subtasks", { id: st.id, status: e.target.value }).then(refetch)} className="text-xs bg-gray-100/80 dark:bg-gray-800/60 border border-gray-200/60 dark:border-gray-700/60 rounded-lg px-2.5 py-1 text-gray-700 dark:text-gray-300">{Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
                </div>
              ))}
              {(!task.subtasks || task.subtasks.length === 0) && <p className="text-sm text-gray-400">No subtasks</p>}
            </div>

            {/* Dependencies — structured */}
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-6 space-y-4">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Dependencies</h3>

              {/* Prerequisite To */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Prerequisite To <span className="text-gray-400 font-normal">(tasks that depend on this)</span></p>
                {(task.deps_to || []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between bg-gray-50/80 dark:bg-gray-800/30 rounded-lg px-3 py-2 mb-1">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.task ? STATUS_COLORS[d.task.status] : "#9CA3AF" }} /><span className="text-sm text-gray-700 dark:text-gray-300">{d.task?.title}</span>{d.task?.category && <span className="text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{d.task.category}</span>}</div>
                    {isDoer && <button onClick={() => removeDependency(d.id)} className="text-gray-400 hover:text-red-500 transition-colors"><HiX className="w-3.5 h-3.5" /></button>}
                  </div>
                ))}
                {isDoer && <button onClick={() => setShowDepAdd("prerequisite")} className="text-xs text-indigo-500 hover:text-indigo-400 mt-1">+ Add prerequisite</button>}
              </div>

              {/* Has Dependency On */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Has Dependency On <span className="text-gray-400 font-normal">(must complete before this)</span></p>
                {(task.deps_from || []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between bg-gray-50/80 dark:bg-gray-800/30 rounded-lg px-3 py-2 mb-1">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.depends_on ? STATUS_COLORS[d.depends_on.status] : "#9CA3AF" }} /><span className="text-sm text-gray-700 dark:text-gray-300">{d.depends_on?.title}</span>{d.depends_on?.category && <span className="text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{d.depends_on.category}</span>}</div>
                    {isDoer && <button onClick={() => removeDependency(d.id)} className="text-gray-400 hover:text-red-500 transition-colors"><HiX className="w-3.5 h-3.5" /></button>}
                  </div>
                ))}
                {isDoer && <button onClick={() => setShowDepAdd("dependency")} className="text-xs text-indigo-500 hover:text-indigo-400 mt-1">+ Add dependency</button>}
              </div>

              {/* Add dependency modal */}
              {showDepAdd && (
                <div className="bg-gray-50/80 dark:bg-gray-800/40 rounded-xl p-4 space-y-3 border border-gray-200/60 dark:border-gray-700/60">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-300">{showDepAdd === "prerequisite" ? "Select task that depends on this one:" : "Select task this depends on:"}</p>
                  <select value={depTaskId} onChange={(e) => setDepTaskId(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white">
                    <option value="">Select task...</option>
                    {categories.map((cat) => (
                      <optgroup key={cat} label={cat as string}>
                        {(allTasks || []).filter(t => t.category === cat && t.id !== id).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={addDependency} disabled={!depTaskId} className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-xs rounded-xl shadow-sm transition-all">Add</button>
                    <button onClick={() => { setShowDepAdd(null); setDepTaskId(""); }} className="text-xs text-gray-500">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-6 space-y-4">
              {/* Owner — always editable for doers */}
              <div>
                <span className="text-xs text-gray-400 block mb-1">Owner</span>
                {isDoer ? (
                  <select value={task.owner_id || ""} onChange={async (e) => { try { await apiPatch(`/api/tasks/${id}`, { owner_id: e.target.value }); await refetch(); } catch {} }}
                    className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200/60 dark:border-gray-700/60 rounded-xl text-sm text-gray-900 dark:text-white">
                    <option value="">Unassigned</option>
                    {(owners || []).map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                  </select>
                ) : (
                  <p className="text-sm text-gray-800 dark:text-white">{task.owner?.full_name || "Unassigned"}</p>
                )}
              </div>
              {/* Status — always editable for doers */}
              <div>
                <span className="text-xs text-gray-400 block mb-1">Status</span>
                {isDoer ? (
                  <select value={task.status} onChange={async (e) => {
                    const v = e.target.value;
                    if (v === "completed") {
                      const blockers = getCompletionBlockers(task as Task & { deliverables?: { id: string }[]; feedback?: { id: string }[] });
                      if (blockers.length) { setError(`Cannot complete: ${blockers.join(". ")}`); return; }
                    }
                    try { await apiPatch(`/api/tasks/${id}`, { status: v }); await refetch(); } catch (e2) { setError(e2 instanceof Error ? e2.message : "Failed"); }
                  }}
                    className="w-full text-sm font-semibold px-3 py-2 rounded-xl border-0 cursor-pointer"
                    style={{ backgroundColor: STATUS_COLORS[task.status] + "15", color: STATUS_COLORS[task.status] }}>
                    {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k} className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">{l}</option>)}
                  </select>
                ) : (
                  <span className="text-sm font-semibold px-3 py-1.5 rounded-full inline-block" style={{ backgroundColor: STATUS_COLORS[task.status] + "15", color: STATUS_COLORS[task.status] }}>{STATUS_LABELS[task.status]}</span>
                )}
              </div>
              {/* Deadline — always editable for doers */}
              <div>
                <span className="text-xs text-gray-400 block mb-1">Deadline</span>
                {isDoer ? (
                  <input type="date" value={task.deadline || ""} onChange={async (e) => { try { await apiPatch(`/api/tasks/${id}`, { deadline: e.target.value }); await refetch(); } catch {} }}
                    className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200/60 dark:border-gray-700/60 rounded-xl text-sm text-gray-900 dark:text-white" />
                ) : (
                  <p className="text-sm text-gray-800 dark:text-white">{task.deadline || "—"}</p>
                )}
              </div>
              <div><span className="text-xs text-gray-400">Category</span><p className="text-sm text-gray-800 dark:text-white">{task.category || "—"}</p></div>
              <div><span className="text-xs text-gray-400">Attachments</span><p className="text-sm text-gray-800 dark:text-white">{task.deliverables?.length || 0} files</p></div>
              <div><span className="text-xs text-gray-400">Feedback</span><p className="text-sm text-gray-800 dark:text-white">{feedbackList.length} entries</p></div>
            </div>

            {/* Deliverables — doers can upload/delete */}
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-6 space-y-3">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Deliverables</h3>
              {(task.deliverables || []).map((d) => (
                <div key={d.id} className="bg-gray-50/80 dark:bg-gray-800/40 rounded-xl px-3 py-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-gray-800 dark:text-white">{d.title}</span>
                      <span className="text-xs text-gray-500 ml-2">v{d.version}</span>
                      {d.viewed ? <span className="ml-2 w-2 h-2 rounded-full bg-green-500 inline-block" title="Viewed" /> : <span className="ml-2 w-2 h-2 rounded-full bg-blue-500 inline-block" title="Not viewed" />}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <a href={d.file_url || "#"} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-all">Open</a>
                      <a href={d.file_url || "#"} download={d.file_name || d.title} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">↓</a>
                      {canDeleteDeliverables(appRole) && !isLocked && <button onClick={() => deleteDeliverable(d.id)} className="text-gray-400 hover:text-red-500 transition-colors"><HiTrash className="w-3 h-3" /></button>}
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400">{new Date(d.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                </div>
              ))}
              {(!task.deliverables || task.deliverables.length === 0) && <p className="text-sm text-gray-400">No deliverables</p>}
              {canUploadDeliverables(appRole) && !isLocked && (
                <div className="space-y-2 pt-2 border-t border-gray-200/60 dark:border-gray-800/60">
                  <input value={fileTitle} onChange={(e) => setFileTitle(e.target.value)} placeholder="File title" className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" />
                  <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-gray-100 dark:file:bg-gray-800" />
                  <button onClick={uploadFile} disabled={!file || uploading} className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-xs rounded-xl shadow-sm transition-all">{uploading ? "Uploading..." : "Upload"}</button>
                </div>
              )}
            </div>

            {/* Quick feedback — assessors only */}
            {isAssessor && (
              <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-violet-200/60 dark:border-violet-800/30 rounded-2xl shadow-sm p-6 space-y-3">
                <h3 className="text-sm font-medium text-violet-600 dark:text-violet-400 uppercase tracking-wider">Add Feedback</h3>
                <div className="flex gap-2">
                  <div className="flex-1"><label className="text-xs text-gray-500">Rating</label><input type="number" min={1} max={10} value={fbRating} onChange={(e) => setFbRating(parseInt(e.target.value))} className="w-full px-3 py-1.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" /></div>
                  <div className="flex-1"><label className="text-xs text-gray-500">Tag</label><select value={fbTag} onChange={(e) => setFbTag(e.target.value)} className="w-full px-3 py-1.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white"><option value="approved">Approved</option><option value="needs_improvement">Needs Improvement</option><option value="blocked">Obstacle</option></select></div>
                </div>
                <textarea value={fbComment} onChange={(e) => setFbComment(e.target.value)} placeholder="Your feedback..." rows={2} className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" />
                <button onClick={submitFeedback} className="px-3 py-1.5 bg-gradient-to-r from-violet-500 to-purple-500 hover:brightness-110 text-white text-xs rounded-xl shadow-sm transition-all">Submit Feedback</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== FEEDBACK TRAIL TAB ===== */}
      {activeTab === "feedback" && (
        <div className="space-y-4 max-w-2xl">
          {feedbackList.length === 0 ? (
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-8 text-center"><p className="text-gray-500">No feedback yet.</p></div>
          ) : feedbackList.map((fb) => {
            const isReply = fb.comment?.startsWith("↩️");
            const isOwner = fb.reviewer_id === dbUser?.id;
            return (
              <div key={fb.id} className={`bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-5 animate-fade-in ${isReply ? "ml-8 border-l-2 border-l-violet-400" : ""}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">{fb.reviewer?.full_name?.[0] || "?"}</div>
                    <div><span className="text-sm font-medium text-gray-800 dark:text-white">{fb.reviewer?.full_name}</span><span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full ${tagColors[fb.tag] || ""}`}>{fb.tag.replace("_", " ")}</span></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-gray-900 dark:text-white">{fb.rating}<span className="text-xs text-gray-400">/10</span></span>
                    {isOwner && canEditFeedback(appRole) && (
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingFb(fb.id); setEditFbComment(fb.comment || ""); setEditFbRating(fb.rating); }} className="text-gray-400 hover:text-indigo-500 transition-colors"><HiPencil className="w-3 h-3" /></button>
                        <button onClick={() => deleteFeedback(fb.id)} className="text-gray-400 hover:text-red-500 transition-colors"><HiTrash className="w-3 h-3" /></button>
                      </div>
                    )}
                  </div>
                </div>

                {editingFb === fb.id ? (
                  <div className="space-y-2 mt-2">
                    <div className="flex gap-2"><input type="number" min={1} max={10} value={editFbRating} onChange={(e) => setEditFbRating(parseInt(e.target.value))} className="w-16 px-2 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm" /><span className="text-xs text-gray-400 self-center">/10</span></div>
                    <textarea value={editFbComment} onChange={(e) => setEditFbComment(e.target.value)} rows={2} className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" />
                    <div className="flex gap-2"><button onClick={() => updateFeedback(fb.id)} className="px-3 py-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xs rounded-lg">Save</button><button onClick={() => setEditingFb(null)} className="text-xs text-gray-500">Cancel</button></div>
                  </div>
                ) : (
                  fb.comment && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{fb.comment}</p>
                )}

                {!isReply && (
                  <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3">
                    {/* Acknowledge — doers only */}
                    {isDoer && !fb.acknowledged && (
                      <button onClick={async () => { try { await apiPatch(`/api/feedback/${fb.id}`, { acknowledged: true, acknowledged_by: dbUser?.id }); await refetch(); } catch {} }}
                        className="flex items-center gap-1 text-[10px] text-green-600 hover:text-green-500 transition-colors"><HiCheck className="w-3 h-3" /> Acknowledge</button>
                    )}
                    {fb.acknowledged && <span className="text-[10px] text-green-500 flex items-center gap-0.5"><HiCheck className="w-3 h-3" /> Acknowledged</span>}
                    {/* Reply */}
                    {replyTo === fb.id ? (
                      <div className="flex gap-2 flex-1"><input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Reply..." autoFocus className="flex-1 px-3 py-1.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" onKeyDown={(e) => e.key === "Enter" && replyToFeedback()} /><button onClick={replyToFeedback} className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-xs rounded-xl">Reply</button><button onClick={() => { setReplyTo(null); setReplyText(""); }} className="text-xs text-gray-400">Cancel</button></div>
                    ) : (
                      <button onClick={() => setReplyTo(fb.id)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-500 transition-colors"><HiReply className="w-3 h-3" /> Reply</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
