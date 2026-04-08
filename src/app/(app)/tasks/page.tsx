"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Task, TaskStatus } from "@/lib/types";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import { useApi, apiPost, apiPatch } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { canEditTasks, canCreateTasks } from "@/lib/roles";
import { HiChevronDown, HiChevronRight, HiPlus, HiOutlineChatAlt, HiOutlinePaperClip, HiCheck } from "react-icons/hi";
import Link from "next/link";

type FullTask = Task & {
  owner?: { id: string; full_name: string };
  subtasks?: { id: string }[];
  deliverables?: { id: string }[];
  feedback?: { id: string; rating: number }[];
};
type UserOption = { id: string; full_name: string; email: string };
type WeekOption = { id: string; week_number: number; start_date: string; end_date: string };
type IterOption = { id: string; name: string; start_date: string; end_date: string; weeks?: WeekOption[] };
type QuarterOption = { id: string; name: string; start_date: string; end_date: string; iterations: IterOption[] };

function fmt(d: string) { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); }

// Predefined categories — always show these even if empty
const FIXED_CATEGORIES = [
  "Customer Success & PG Acquisition",
  "Product / Engineering / Workflows",
  "Cybersecurity",
  "Continuous Learning",
  "Talent Acquisition",
  "Branding",
];

export default function TasksPage() {
  return <Suspense fallback={<div className="p-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500" /></div>}><TasksInner /></Suspense>;
}

function TasksInner() {
  const { appRole } = useAuth();
  const isDoer = canCreateTasks(appRole);
  const searchParams = useSearchParams();
  const initialStatus = (searchParams.get("status") as TaskStatus) || "all";
  const { data: tasks, loading, refetch, setData: setTasks } = useApi<FullTask[]>("/api/tasks");
  const { data: quarters } = useApi<QuarterOption[]>("/api/quarters");
  const { data: users } = useApi<UserOption[]>("/api/users/owners");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">(initialStatus);
  const [catFilter, setCatFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [initialized, setInitialized] = useState(false);

  const all = tasks || [];
  const quarter = quarters?.[0];
  const iterations = quarter?.iterations || [];
  const allUsers = users || [];
  const dynamicCats = [...new Set(all.map((t) => t.category).filter(Boolean))] as string[];
  const categories = [...new Set([...FIXED_CATEGORIES, ...dynamicCats])];

  // Auto-expand on first load
  if (!initialized && (categories.length > 0 || iterations.length > 0)) {
    const auto = new Set<string>();
    auto.add("q");
    categories.forEach((c) => auto.add(c));
    iterations.forEach((i) => {
      auto.add(i.id);
      // Auto-expand weeks that have tasks
      (i.weeks || []).forEach((w) => {
        const weekHasTasks = all.some((t) => t.week_id === w.id);
        if (weekHasTasks) {
          categories.forEach((cat) => auto.add(`${cat}|${i.id}|w${w.id}`));
        }
      });
    });
    queueMicrotask(() => { setExpanded(auto); setInitialized(true); });
  }

  if (loading) return <div className="p-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>;

  const toggle = (k: string) => { const n = new Set(expanded); n.has(k) ? n.delete(k) : n.add(k); setExpanded(n); };

  const filtered = all.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (catFilter !== "all" && t.category !== catFilter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function updateField(taskId: string, field: string, value: string) {
    if (field === "status" && value === "completed") {
      const task = all.find((t) => t.id === taskId);
      if (task && !task.deliverables?.length) { alert("Cannot complete: no deliverable uploaded"); return; }
      if (task && !task.feedback?.length) { alert("Cannot complete: no feedback received"); return; }
    }
    // Optimistic update — instant UI, no flash
    setTasks((prev) => prev ? prev.map((t) => t.id === taskId ? { ...t, [field]: value || null } : t) : prev);
    // Sync to API in background
    try { await apiPatch(`/api/tasks/${taskId}`, { [field]: value || null }); }
    catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
      await refetch(); // Revert on error
    }
  }

  async function quickAddTask(category: string, iterationId: string) {
    if (!newTitle.trim() || !allUsers[0]) return;
    const title = newTitle.trim();
    setNewTitle(""); setAddingTo(null);
    try {
      const created = await apiPost("/api/tasks", {
        title, category, owner_id: allUsers[0].id,
        deadline: iterations.find((i) => i.id === iterationId)?.end_date || "2026-07-04",
        quarter_id: quarter?.id || null, iteration_id: iterationId, status: "not_started",
      });
      setTasks((prev) => prev ? [...prev, { ...created, owner: allUsers[0], subtasks: [], deliverables: [], feedback: [] }] : prev);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); await refetch(); }
  }

  async function quickAddWeekTask(category: string, iterationId: string, weekId: string) {
    if (!newTitle.trim() || !allUsers[0]) return;
    const title = newTitle.trim();
    const week = iterations.flatMap((i) => i.weeks || []).find((w) => w.id === weekId);
    setNewTitle(""); setAddingTo(null);
    try {
      const created = await apiPost("/api/tasks", {
        title, category, owner_id: allUsers[0].id,
        deadline: week?.end_date || "2026-07-04",
        quarter_id: quarter?.id || null, iteration_id: iterationId, week_id: weekId, status: "not_started",
      });
      setTasks((prev) => prev ? [...prev, { ...created, owner: allUsers[0], subtasks: [], deliverables: [], feedback: [] }] : prev);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); await refetch(); }
  }

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tasks</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{filtered.length} items</span>
          {isDoer && <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm rounded-xl shadow-md hover:shadow-lg hover:brightness-110 transition-all active:scale-[0.97]">
            <HiPlus className="w-4 h-4" /> New Task
          </button>}
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-xs">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..."
              className="w-full pl-9 pr-4 py-2.5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all" />
            <svg className="absolute left-3 top-3 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
            className="px-4 py-2.5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all">
            <option value="all">All Categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {/* Status pills */}
        <div className="flex gap-2 flex-wrap">
          {[{ key: "all", label: "All" }, ...Object.entries(STATUS_LABELS).map(([k, l]) => ({ key: k, label: l }))].map(({ key, label }) => {
            const isActive = statusFilter === key;
            const color = key !== "all" ? STATUS_COLORS[key as TaskStatus] : undefined;
            const count = key === "all" ? filtered.length : all.filter((t) => t.status === key).length;
            return (
              <button key={key} onClick={() => setStatusFilter(key as TaskStatus | "all")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                  isActive
                    ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm"
                    : "bg-white/80 dark:bg-gray-800/80 text-gray-600 dark:text-gray-400 border border-gray-200/60 dark:border-gray-700/60 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}>
                {color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isActive ? "white" : color }} />}
                {label}
                <span className={`text-[10px] ${isActive ? "text-white/70" : "text-gray-400"}`}>({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Full structure: Quarter → Category → Iteration (Goals) → Week (Tasks) */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm overflow-x-auto">
        {/* Quarter */}
        <button onClick={() => toggle("q")}
          className="flex items-center gap-2 w-full text-left px-4 py-3 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all duration-200 border-b border-gray-200 dark:border-gray-800">
          {expanded.has("q") ? <HiChevronDown className="w-5 h-5 text-gray-400" /> : <HiChevronRight className="w-5 h-5 text-gray-400" />}
          <span className="text-base font-bold text-gray-900 dark:text-white">{quarter?.name || "Q2 2026"}</span>
          {quarter && <span className="text-xs text-gray-400">{fmt(quarter.start_date)} — {fmt(quarter.end_date)}</span>}
          <span className="ml-auto text-xs text-gray-400">{all.length} items</span>
        </button>

        {expanded.has("q") && <div className="stagger-children">{categories.map((cat) => {
          if (catFilter !== "all" && catFilter !== cat) return null;
          const catTasks = filtered.filter((t) => t.category === cat);

          return (
            <div key={cat} className="border-b border-gray-100 dark:border-gray-800/50 last:border-b-0">
              {/* Category */}
              <button onClick={() => toggle(cat)}
                className="flex items-center gap-2 w-full text-left px-6 py-2.5 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all duration-200">
                {expanded.has(cat) ? <HiChevronDown className="w-4 h-4 text-gray-400" /> : <HiChevronRight className="w-4 h-4 text-gray-400" />}
                <span className="text-sm font-semibold text-gray-800 dark:text-white">{cat}</span>
                <span className="ml-auto text-xs text-gray-400">{catTasks.length}</span>
              </button>

              {expanded.has(cat) && (
                <div className="pl-4">
                  {/* Column headers */}
                  <div className="grid grid-cols-[minmax(220px,1fr)_100px_110px_100px_40px] gap-0 px-6 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800/30">
                    <span>Goal / Outcome</span>
                    <span>Owner</span>
                    <span>Status</span>
                    <span>Deadline</span>
                    <span></span>
                  </div>

                  {/* Always show all iterations */}
                  {iterations.map((iter) => {
                    const iterTasks = catTasks.filter((t) => t.iteration_id === iter.id && !t.week_id);
                    const iterKey = `${cat}|${iter.id}`;

                    return (
                      <div key={iter.id}>
                        {/* Iteration header */}
                        <button onClick={() => toggle(iterKey)}
                          className="flex items-center gap-2 w-full text-left px-6 py-1.5 bg-gray-50/50 dark:bg-gray-800/15 border-b border-gray-100 dark:border-gray-800/30 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all duration-200">
                          {expanded.has(iterKey) ? <HiChevronDown className="w-3 h-3 text-gray-400" /> : <HiChevronRight className="w-3 h-3 text-gray-400" />}
                          <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">{iter.name} — Goals / Outcomes</span>
                          <span className="text-[10px] text-gray-400">{fmt(iter.start_date)} — {fmt(iter.end_date)}</span>
                          <span className="ml-auto text-[10px] text-gray-400">{iterTasks.length}</span>
                        </button>

                        {expanded.has(iterKey) && (
                          <>
                            {/* Iteration-level goals */}
                            {iterTasks.map((task) => (
                              <TaskRow key={task.id} task={task} onUpdate={updateField} owners={allUsers} editable={isDoer} />
                            ))}

                            {/* Quick add goal — doers only */}
                            {isDoer && (addingTo === iterKey ? (
                              <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-100/50 dark:border-gray-800/15">
                                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New goal / outcome..." autoFocus
                                  className="flex-1 w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                  onKeyDown={(e) => { if (e.key === "Enter") quickAddTask(cat, iter.id); if (e.key === "Escape") { setAddingTo(null); setNewTitle(""); } }} />
                                <button onClick={() => quickAddTask(cat, iter.id)} className="text-green-500"><HiCheck className="w-4 h-4" /></button>
                                <button onClick={() => { setAddingTo(null); setNewTitle(""); }} className="text-xs text-gray-400">✕</button>
                              </div>
                            ) : (
                              <button onClick={() => { setAddingTo(iterKey); setNewTitle(""); }}
                                className="flex items-center gap-1.5 px-6 py-1.5 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all duration-200 w-full text-left border-b border-gray-100/50 dark:border-gray-800/15">
                                <HiPlus className="w-3 h-3" /> Add goal
                              </button>
                            ))}

                            {/* Always show all 3 weeks */}
                            {(iter.weeks || []).map((week) => {
                              const weekTasks = catTasks.filter((t) => t.week_id === week.id);
                              const weekKey = `${cat}|${iter.id}|w${week.id}`;

                              return (
                                <div key={week.id}>
                                  {/* Week header — clickable to open week view */}
                                  <div className="flex items-center border-b border-gray-100/50 dark:border-gray-800/15">
                                    <button onClick={() => toggle(weekKey)}
                                      className="flex items-center gap-2 flex-1 text-left pl-10 pr-2 py-1.5 bg-gray-50/30 dark:bg-gray-800/8 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all duration-200">
                                      {expanded.has(weekKey) ? <HiChevronDown className="w-2.5 h-2.5 text-gray-300" /> : <HiChevronRight className="w-2.5 h-2.5 text-gray-300" />}
                                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">Week {week.week_number} — Tasks</span>
                                      <span className="text-[10px] text-gray-300 dark:text-gray-600">{fmt(week.start_date)} — {fmt(week.end_date)}</span>
                                      {weekTasks.length > 0 && <span className="text-[10px] text-gray-400 ml-1">{weekTasks.length}</span>}
                                    </button>
                                    <Link href={`/weeks/${week.id}`} className="text-[9px] text-blue-500 hover:text-blue-400 pr-4 transition-all duration-200">Open →</Link>
                                  </div>

                                  {expanded.has(weekKey) && (
                                    <div className="pl-6">
                                      {/* Week tasks table */}
                                      {weekTasks.length > 0 && (
                                        <div className="grid grid-cols-[minmax(220px,1fr)_100px_110px_100px_40px] gap-0 px-6 py-1 text-[9px] font-semibold text-gray-300 dark:text-gray-600 uppercase tracking-wider border-b border-gray-100/30 dark:border-gray-800/10">
                                          <span>Task</span><span>Owner</span><span>Status</span><span>Due</span><span></span>
                                        </div>
                                      )}
                                      {weekTasks.map((task) => (
                                        <TaskRow key={task.id} task={task} onUpdate={updateField} owners={allUsers} editable={isDoer} />
                                      ))}
                                      {weekTasks.length === 0 && addingTo !== weekKey && (
                                        <p className="text-[10px] text-gray-300 dark:text-gray-600 px-6 py-2 italic border-b border-gray-100/30 dark:border-gray-800/10">No tasks yet</p>
                                      )}

                                      {/* Quick add week task — doers only */}
                                      {isDoer && (addingTo === weekKey ? (
                                        <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-100/30 dark:border-gray-800/10">
                                          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New task..." autoFocus
                                            className="flex-1 w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                            onKeyDown={(e) => { if (e.key === "Enter") quickAddWeekTask(cat, iter.id, week.id); if (e.key === "Escape") { setAddingTo(null); setNewTitle(""); } }} />
                                          <button onClick={() => quickAddWeekTask(cat, iter.id, week.id)} className="text-green-500"><HiCheck className="w-4 h-4" /></button>
                                          <button onClick={() => { setAddingTo(null); setNewTitle(""); }} className="text-xs text-gray-400">✕</button>
                                        </div>
                                      ) : (
                                        <button onClick={() => { setAddingTo(weekKey); setNewTitle(""); }}
                                          className="flex items-center gap-1 px-6 py-1.5 text-[10px] text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all duration-200 w-full text-left border-b border-gray-100/30 dark:border-gray-800/10">
                                          <HiPlus className="w-2.5 h-2.5" /> Add task
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}</div>}
      </div>

      {showCreate && (
        <CreateTaskModal users={allUsers} quarters={quarters || []} categories={categories}
          onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refetch(); }} />
      )}
    </div>
  );
}

function TaskRow({ task, onUpdate, editable = true, owners = [] }: { task: FullTask; onUpdate: (id: string, field: string, value: string) => void; editable?: boolean; owners?: UserOption[] }) {
  return (
    <div className="grid grid-cols-[minmax(220px,1fr)_100px_110px_100px_40px] gap-0 px-6 py-2 border-b border-gray-100/50 dark:border-gray-800/15 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all duration-200 group items-center">
      <div className="flex items-center gap-2 min-w-0 pr-2">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[task.status] }} />
        <Link href={`/tasks/${task.id}`} className="text-sm text-gray-700 dark:text-gray-200 hover:text-indigo-500 truncate transition-all duration-200">{task.title}</Link>
        {(task.subtasks?.length || 0) > 0 && <span className="text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded flex-shrink-0">{task.subtasks!.length}</span>}
        {(task.deliverables?.length || 0) > 0 && <HiOutlinePaperClip className="w-3 h-3 text-blue-500 flex-shrink-0" />}
        {(task.feedback?.length || 0) > 0 && <HiOutlineChatAlt className="w-3 h-3 text-violet-400 flex-shrink-0" />}
      </div>
      {/* Owner */}
      {editable ? (
        <select value={task.owner_id || ""} onChange={(e) => onUpdate(task.id, "owner_id", e.target.value)}
          className="text-[11px] text-gray-600 dark:text-gray-400 bg-transparent border-0 cursor-pointer w-full truncate">
          <option value="" className="bg-white dark:bg-gray-900">—</option>
          {owners.map((o) => <option key={o.id} value={o.id} className="bg-white dark:bg-gray-900">{o.full_name}</option>)}
        </select>
      ) : (
        <span className="text-[11px] text-gray-500 truncate">{task.owner?.full_name || owners.find((o) => o.id === task.owner_id)?.full_name || "—"}</span>
      )}
      {/* Status */}
      {editable ? (
        <select value={task.status} onChange={(e) => onUpdate(task.id, "status", e.target.value)}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-full border-0 cursor-pointer appearance-none transition-all duration-200"
          style={{ backgroundColor: STATUS_COLORS[task.status] + "20", color: STATUS_COLORS[task.status] }}>
          {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k} className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">{l}</option>)}
        </select>
      ) : (
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: STATUS_COLORS[task.status] + "18", color: STATUS_COLORS[task.status] }}>{STATUS_LABELS[task.status]}</span>
      )}
      {/* Deadline */}
      {editable ? (
        <input type="date" value={task.deadline || ""} onChange={(e) => onUpdate(task.id, "deadline", e.target.value)}
          className="text-[11px] text-gray-500 dark:text-gray-400 bg-transparent border-0 cursor-pointer w-full" />
      ) : (
        <span className="text-[11px] text-gray-500">{task.deadline || "—"}</span>
      )}
      <Link href={`/tasks/${task.id}`} className="text-[10px] text-gray-400 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-all duration-200">Open</Link>
    </div>
  );
}

function CreateTaskModal({ users, quarters, categories, onClose, onCreated }: {
  users: UserOption[]; quarters: QuarterOption[]; categories: string[]; onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(categories[0] || "");
  const [newCat, setNewCat] = useState("");
  const [ownerId, setOwnerId] = useState(users[0]?.id || "");
  const [deadline, setDeadline] = useState("");
  const [iterationId, setIterationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const iterations = quarters[0]?.iterations || [];

  async function handleCreate() {
    if (!title || !ownerId || !deadline) { setError("Title, owner, and deadline are required"); return; }
    setSaving(true); setError("");
    try {
      await apiPost("/api/tasks", {
        title, description: description || null, category: newCat || category || null,
        owner_id: ownerId, deadline, quarter_id: quarters[0]?.id || null,
        iteration_id: iterationId || null, status: "not_started",
      });
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/60 dark:border-gray-700/60 rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-2xl">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Create Task</h2>
        {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>}
        <div><label className="text-xs text-gray-500 mb-1 block">Title *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all" /></div>
        <div><label className="text-xs text-gray-500 mb-1 block">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-gray-500 mb-1 block">Category</label>
            <select value={category} onChange={(e) => { setCategory(e.target.value); setNewCat(""); }}
              className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all">
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="__new">+ New</option>
            </select>
            {category === "__new" && <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Category name" className="w-full mt-2 px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all" />}
          </div>
          <div><label className="text-xs text-gray-500 mb-1 block">Owner *</label>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all">
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-gray-500 mb-1 block">Deadline *</label>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all" /></div>
          <div><label className="text-xs text-gray-500 mb-1 block">Iteration</label>
            <select value={iterationId} onChange={(e) => setIterationId(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all">
              <option value="">None</option>
              {iterations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select></div>
        </div>
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all">Cancel</button>
          <button onClick={handleCreate} disabled={saving || !title || !ownerId || !deadline}
            className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-sm rounded-xl shadow-md transition-all active:scale-[0.97]">
            {saving ? "Creating..." : "Create Task"}
          </button>
        </div>
      </div>
    </div>
  );
}
