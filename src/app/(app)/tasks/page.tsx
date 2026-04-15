"use client";

import { useState, useEffect, useRef, Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { Task, TaskStatus } from "@/lib/types";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import { useApi, apiPost, apiPatch } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { canEditTasks, canCreateTasks } from "@/lib/roles";
import { HiChevronDown, HiChevronRight, HiPlus, HiOutlineChatAlt, HiOutlinePaperClip, HiCheck } from "react-icons/hi";
import Link from "next/link";
import { FIXED_CATEGORIES, OWNER_STYLE, CAT_SHORT } from "@/lib/constants";
import { formatDate, isReplyComment } from "@/lib/utils";
import { Skeleton, SkeletonRows, useToast } from "@/components/ui";
import { handleApiError } from "@/lib/utils";

type FullTask = Task & {
  owner?: { id: string; full_name: string };
  subtasks?: { id: string }[];
  deliverables?: { id: string }[];
  feedback?: { id: string; rating: number; acknowledged?: boolean; comment?: string }[];
};
type UserOption = { id: string; full_name: string; email: string };
type WeekOption = { id: string; week_number: number; start_date: string; end_date: string };
type IterOption = { id: string; name: string; start_date: string; end_date: string; weeks?: WeekOption[] };
type QuarterOption = { id: string; name: string; start_date: string; end_date: string; iterations: IterOption[] };

export default function TasksPage() {
  return <Suspense fallback={<div className="p-8 space-y-4 animate-fade-in"><div className="flex items-center justify-between"><div className="skeleton h-8 w-48" /><div className="skeleton h-9 w-28 rounded-xl" /></div><div className="flex gap-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-7 w-20 rounded-full" />)}</div><SkeletonRows count={8} /></div>}><TasksInner /></Suspense>;
}

function TasksInner() {
  const { toast } = useToast();
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
  const [iterFilter, setIterFilter] = useState<string>("all");
  const [weekFilter, setWeekFilter] = useState<string>("all");
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
  const categories = useMemo(() => [...new Set([...FIXED_CATEGORIES, ...dynamicCats])], [all]);

  // Auto-expand — runs on first load AND whenever filters change
  const filterKey = `${catFilter}|${iterFilter}|${weekFilter}|${statusFilter}`;
  if (!initialized && (categories.length > 0 || iterations.length > 0)) {
    queueMicrotask(() => { expandForCurrentView(); setInitialized(true); });
  }

  function expandForCurrentView() {
    const auto = new Set<string>();
    auto.add("q");
    const tasksToShow = all.filter((t) => {
      if (catFilter !== "all" && t.category !== catFilter) return false;
      if (iterFilter !== "all" && t.iteration_id !== iterFilter) return false;
      if (weekFilter !== "all" && t.week_id !== weekFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      return true;
    });
    // Expand categories that have matching tasks
    categories.forEach((c) => { if (tasksToShow.some((t) => t.category === c)) auto.add(c); });
    // Expand iterations that have matching tasks
    iterations.forEach((i) => {
      if (tasksToShow.some((t) => t.iteration_id === i.id)) {
        auto.add(i.id);
        // Also expand matching iteration key per category
        categories.forEach((cat) => {
          if (tasksToShow.some((t) => t.iteration_id === i.id && t.category === cat)) {
            auto.add(`${cat}|${i.id}`);
          }
        });
      }
      // Expand weeks that have matching tasks
      (i.weeks || []).forEach((w) => {
        if (tasksToShow.some((t) => t.week_id === w.id)) {
          categories.forEach((cat) => auto.add(`${cat}|${i.id}|w${w.id}`));
        }
      });
    });
    setExpanded(auto);
  }

  // Re-expand when filters change
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (initialized && prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
      expandForCurrentView();
    }
  });

  if (loading) return (
    <div className="p-8 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between"><div className="skeleton h-8 w-48" /><div className="skeleton h-9 w-28 rounded-xl" /></div>
      <div className="flex gap-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-7 w-20 rounded-full" />)}</div>
      <SkeletonRows count={8} />
    </div>
  );

  const toggle = (k: string) => { const n = new Set(expanded); n.has(k) ? n.delete(k) : n.add(k); setExpanded(n); };

  const filtered = all.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (catFilter !== "all" && t.category !== catFilter) return false;
    if (iterFilter !== "all" && t.iteration_id !== iterFilter) return false;
    if (weekFilter !== "all" && t.week_id !== weekFilter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const overdueCount = all.filter((t) => t.deadline && new Date(t.deadline) < new Date() && t.status !== "completed").length;
  const dueTodayCount = all.filter((t) => t.deadline === new Date().toISOString().split("T")[0] && t.status !== "completed").length;

  async function updateField(taskId: string, field: string, value: string) {
    if (field === "status" && value === "completed") {
      const task = all.find((t) => t.id === taskId);
      if (task && !task.deliverables?.length) { toast("Cannot complete: no deliverable uploaded", "error"); return; }
      if (task && !task.feedback?.length) { toast("Cannot complete: no feedback received", "error"); return; }
    }
    // Optimistic update — instant UI, no flash
    setTasks((prev) => prev ? prev.map((t) => t.id === taskId ? { ...t, [field]: value || null } : t) : prev);
    // Sync to API in background
    try { await apiPatch(`/api/tasks/${taskId}`, { [field]: value || null }); }
    catch (e) {
      toast(handleApiError(e), "error");
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
    } catch (e) { toast(handleApiError(e), "error"); await refetch(); }
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
    } catch (e) { toast(handleApiError(e), "error"); await refetch(); }
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

      {/* ── Navigation Filters ── */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-4 space-y-4">

        {/* Row 1: Primary filters — Iteration, Category, Week as prominent button groups */}
        <div className="space-y-2.5">
          {/* Iteration selector — large, always visible */}
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Iteration</label>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => { setIterFilter("all"); setWeekFilter("all"); }}
                className={`px-3.5 py-2 text-xs font-medium rounded-xl transition-all ${iterFilter === "all" ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm" : "bg-gray-100/80 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:bg-gray-200/80 dark:hover:bg-gray-700/60"}`}>
                All
              </button>
              {iterations.map((i) => {
                const count = all.filter(t => t.iteration_id === i.id && (catFilter === "all" || t.category === catFilter)).length;
                return (
                  <button key={i.id} onClick={() => { setIterFilter(i.id); setWeekFilter("all"); }}
                    className={`px-3.5 py-2 text-xs font-medium rounded-xl transition-all ${iterFilter === i.id ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm" : "bg-gray-100/80 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:bg-gray-200/80 dark:hover:bg-gray-700/60"}`}>
                    {i.name} <span className={iterFilter === i.id ? "text-white/60" : "text-gray-400"}>({count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Week selector — shows weeks for selected iteration, or all weeks */}
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Week</label>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => setWeekFilter("all")}
                className={`px-3.5 py-2 text-xs font-medium rounded-xl transition-all ${weekFilter === "all" ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-sm" : "bg-gray-100/80 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:bg-gray-200/80 dark:hover:bg-gray-700/60"}`}>
                All Weeks
              </button>
              {(iterFilter !== "all"
                ? (iterations.find(i => i.id === iterFilter)?.weeks || [])
                : iterations.flatMap(i => (i.weeks || []).map(w => ({ ...w, iterName: i.name })))
              ).map((w) => {
                const weekCount = all.filter(t => t.week_id === w.id && (catFilter === "all" || t.category === catFilter)).length;
                const label = "iterName" in w ? `${(w as { iterName: string }).iterName} · W${w.week_number}` : `Week ${w.week_number}`;
                return (
                  <button key={w.id} onClick={() => setWeekFilter(w.id)}
                    className={`px-3.5 py-2 text-xs font-medium rounded-xl transition-all ${weekFilter === w.id ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-sm" : "bg-gray-100/80 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:bg-gray-200/80 dark:hover:bg-gray-700/60"}`}>
                    {label} {weekCount > 0 && <span className={weekFilter === w.id ? "text-white/60" : "text-gray-400"}>({weekCount})</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Category selector — pill buttons */}
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Category</label>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => setCatFilter("all")}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all ${catFilter === "all" ? "bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-sm" : "bg-gray-100/80 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:bg-gray-200/80 dark:hover:bg-gray-700/60"}`}>
                All
              </button>
              {categories.map((c) => {
                const count = all.filter(t => t.category === c && (iterFilter === "all" || t.iteration_id === iterFilter) && (weekFilter === "all" || t.week_id === weekFilter)).length;
                return (
                  <button key={c} onClick={() => setCatFilter(c)}
                    className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all ${catFilter === c ? "bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-sm" : "bg-gray-100/80 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:bg-gray-200/80 dark:hover:bg-gray-700/60"}`}>
                    {CAT_SHORT[c] || c} <span className={catFilter === c ? "text-white/60" : "text-gray-400"}>({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Row 2: Search + Status pills + alerts */}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-200/60 dark:border-gray-800/40">
          <div className="relative min-w-[180px] max-w-[220px]">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..."
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200/40 dark:border-gray-700/40 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all" />
            <svg className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
          {[{ key: "all", label: "All" }, ...Object.entries(STATUS_LABELS).map(([k, l]) => ({ key: k, label: l }))].map(({ key, label }) => {
            const isActive = statusFilter === key;
            const color = key !== "all" ? STATUS_COLORS[key as TaskStatus] : undefined;
            const count = key === "all" ? filtered.length : filtered.filter((t) => t.status === key).length;
            if (key !== "all" && count === 0) return null;
            return (
              <button key={key} onClick={() => setStatusFilter(key as TaskStatus | "all")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all duration-200 ${
                  isActive
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm"
                    : "bg-gray-100/80 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 hover:bg-gray-200/80 dark:hover:bg-gray-700/60"
                }`}>
                {color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isActive ? (color === "#9CA3AF" ? "white" : color) : color }} />}
                {label} <span className={`${isActive ? "opacity-60" : "text-gray-400"}`}>{count}</span>
              </button>
            );
          })}
          <div className="flex items-center gap-2 ml-auto">
            {dueTodayCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-lg">
                Due Today: {dueTodayCount}
              </span>
            )}
            {overdueCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg">
                Overdue: {overdueCount}
              </span>
            )}
            {(catFilter !== "all" || iterFilter !== "all" || weekFilter !== "all" || statusFilter !== "all" || search) && (
              <button onClick={() => { setCatFilter("all"); setIterFilter("all"); setWeekFilter("all"); setStatusFilter("all"); setSearch(""); }}
                className="px-2.5 py-1 text-[10px] text-red-500 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-all font-medium">
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Task Table — shows only matching items, no empty shells */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm overflow-x-auto">
        {/* Quarter header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <span className="text-base font-bold text-gray-900 dark:text-white">{quarter?.name || "Q2 2026"}</span>
          {quarter && <span className="text-xs text-gray-400">{formatDate(quarter.start_date)} — {formatDate(quarter.end_date)}</span>}
          <span className="ml-auto text-xs text-gray-500">{filtered.length} of {all.length}</span>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-[minmax(220px,1fr)_100px_110px_110px_40px] gap-0 px-6 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800/30 sticky top-0 bg-white/95 dark:bg-gray-900/95 z-10">
          <span>Task / Goal</span><span>Owner</span><span>Status</span><span>Deadline</span><span></span>
        </div>

        <div className="stagger-children">{categories.map((cat) => {
          const catTasks = filtered.filter((t) => t.category === cat);
          if (catTasks.length === 0) return null;

          return (
            <div key={cat} className="border-b border-gray-100 dark:border-gray-800/50 last:border-b-0">
              {/* Category header */}
              <button onClick={() => toggle(cat)}
                className="flex items-center gap-2 w-full text-left px-5 py-2 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all duration-200 bg-gray-50/50 dark:bg-gray-800/20">
                {expanded.has(cat) ? <HiChevronDown className="w-4 h-4 text-gray-400" /> : <HiChevronRight className="w-4 h-4 text-gray-400" />}
                <span className="text-sm font-semibold text-gray-800 dark:text-white">{cat}</span>
                <span className="ml-auto text-xs text-gray-400">{catTasks.length}</span>
              </button>

              {expanded.has(cat) && (
                <div>
                  {/* Iterations — only show those with matching tasks */}
                  {iterations.map((iter) => {
                    const iterGoals = catTasks.filter((t) => t.iteration_id === iter.id && !t.week_id);
                    const iterWeekTasks = catTasks.filter((t) => t.iteration_id === iter.id && t.week_id);
                    if (iterGoals.length === 0 && iterWeekTasks.length === 0) return null;
                    const iterKey = `${cat}|${iter.id}`;

                    return (
                      <div key={iter.id}>
                        {/* Iteration sub-header */}
                        <button onClick={() => toggle(iterKey)}
                          className="flex items-center gap-2 w-full text-left px-6 py-1.5 bg-gray-50/30 dark:bg-gray-800/10 border-b border-gray-100/60 dark:border-gray-800/20 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/5 transition-all">
                          {expanded.has(iterKey) ? <HiChevronDown className="w-3 h-3 text-gray-400" /> : <HiChevronRight className="w-3 h-3 text-gray-400" />}
                          <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">{iter.name}</span>
                          <span className="text-[10px] text-gray-400">{formatDate(iter.start_date)} — {formatDate(iter.end_date)}</span>
                          <span className="ml-auto text-[10px] text-gray-400">{iterGoals.length + iterWeekTasks.length}</span>
                        </button>

                        {expanded.has(iterKey) && (
                          <>
                            {/* Iteration goals */}
                            {iterGoals.length > 0 && (
                              <div className="border-l-2 border-amber-400/40 ml-6">
                                {iterGoals.map((task) => (
                                  <TaskRow key={task.id} task={task} onUpdate={updateField} owners={allUsers} editable={isDoer} />
                                ))}
                              </div>
                            )}
                            {isDoer && (addingTo === iterKey ? (
                              <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-100/50 dark:border-gray-800/15">
                                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New goal..." autoFocus
                                  className="flex-1 px-4 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/40 transition-all"
                                  onKeyDown={(e) => { if (e.key === "Enter") quickAddTask(cat, iter.id); if (e.key === "Escape") { setAddingTo(null); setNewTitle(""); } }} />
                                <button onClick={() => quickAddTask(cat, iter.id)} className="text-green-500"><HiCheck className="w-4 h-4" /></button>
                                <button onClick={() => { setAddingTo(null); setNewTitle(""); }} className="text-xs text-gray-400">✕</button>
                              </div>
                            ) : (
                              <button onClick={() => { setAddingTo(iterKey); setNewTitle(""); }}
                                className="flex items-center gap-1.5 px-6 py-1 text-[11px] text-gray-400 hover:text-gray-600 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/5 w-full text-left border-b border-gray-100/30 dark:border-gray-800/10 transition-all">
                                <HiPlus className="w-3 h-3" /> Add goal
                              </button>
                            ))}

                            {/* Weeks — only show those with matching tasks */}
                            {(iter.weeks || []).map((week) => {
                              const weekTasks = catTasks.filter((t) => t.week_id === week.id);
                              if (weekTasks.length === 0 && weekFilter === "all" && iterFilter === "all") return null;
                              if (weekTasks.length === 0 && weekFilter !== "all" && weekFilter !== week.id) return null;
                              const weekKey = `${cat}|${iter.id}|w${week.id}`;

                              return (
                                <div key={week.id}>
                                  <div className="flex items-center border-b border-gray-100/40 dark:border-gray-800/10">
                                    <button onClick={() => toggle(weekKey)}
                                      className="flex items-center gap-2 flex-1 text-left pl-10 pr-2 py-1.5 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/5 transition-all">
                                      {expanded.has(weekKey) ? <HiChevronDown className="w-2.5 h-2.5 text-gray-300" /> : <HiChevronRight className="w-2.5 h-2.5 text-gray-300" />}
                                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">W{week.week_number}</span>
                                      <span className="text-[10px] text-gray-300 dark:text-gray-600">{formatDate(week.start_date)} — {formatDate(week.end_date)}</span>
                                      <span className="text-[10px] text-gray-400 ml-1">{weekTasks.length}</span>
                                    </button>
                                    <Link href={`/weeks/${week.id}`} className="text-[9px] text-indigo-500 hover:text-indigo-400 pr-4 transition-all">Open →</Link>
                                  </div>

                                  {expanded.has(weekKey) && (
                                    <div className="border-l-2 border-indigo-400/20 ml-10">
                                      {weekTasks.map((task) => (
                                        <TaskRow key={task.id} task={task} onUpdate={updateField} owners={allUsers} editable={isDoer} />
                                      ))}
                                      {weekTasks.length === 0 && <p className="text-[10px] text-gray-300 dark:text-gray-600 px-6 py-2 italic">No tasks</p>}
                                      {isDoer && (addingTo === weekKey ? (
                                        <div className="flex items-center gap-2 px-6 py-2">
                                          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New task..." autoFocus
                                            className="flex-1 px-4 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500/40 transition-all"
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
        })}</div>
      </div>

      {showCreate && (
        <CreateTaskModal users={allUsers} quarters={quarters || []} categories={categories}
          onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refetch(); }} />
      )}
    </div>
  );
}

function TaskRow({ task, onUpdate, editable = true, owners = [] }: { task: FullTask; onUpdate: (id: string, field: string, value: string) => void; editable?: boolean; owners?: UserOption[] }) {
  const todayStr = new Date().toISOString().split("T")[0];
  const isOverdue = task.deadline && task.deadline < todayStr && task.status !== "completed";
  const isDueToday = task.deadline === todayStr && task.status !== "completed";
  const ownerName = task.owner?.full_name || owners.find((o) => o.id === task.owner_id)?.full_name || "";
  const ownerStyle = OWNER_STYLE[ownerName];

  // Highlight states for review workflow
  const hasDeliverables = (task.deliverables?.length || 0) > 0;
  const hasFeedback = (task.feedback?.length || 0) > 0;
  const hasUnacknowledgedFb = (task.feedback || []).some(f => !f.acknowledged && !isReplyComment(f.comment));
  const needsReview = hasDeliverables && !hasFeedback;
  const needsAck = hasFeedback && hasUnacknowledgedFb;

  return (
    <div className={`grid grid-cols-[minmax(220px,1fr)_100px_110px_110px_40px] gap-0 px-6 py-2 border-b border-l-[3px] transition-all duration-200 group items-center ${
      isOverdue
        ? `border-red-200/60 dark:border-red-900/30 bg-red-50/40 dark:bg-red-900/8 hover:bg-red-50/70 dark:hover:bg-red-900/15 ${ownerStyle?.border || "border-l-transparent"}`
        : isDueToday
        ? `border-amber-200/60 dark:border-amber-900/30 bg-amber-50/30 dark:bg-amber-900/5 hover:bg-amber-50/60 dark:hover:bg-amber-900/10 ${ownerStyle?.border || "border-l-transparent"}`
        : needsReview
        ? `border-blue-200/60 dark:border-blue-900/30 bg-gradient-to-r from-blue-50/60 to-cyan-50/40 dark:from-blue-900/10 dark:to-cyan-900/8 hover:from-blue-50/80 hover:to-cyan-50/60 ${ownerStyle?.border || "border-l-transparent"}`
        : needsAck
        ? `border-amber-200/60 dark:border-amber-900/30 bg-gradient-to-r from-amber-50/50 to-yellow-50/40 dark:from-amber-900/10 dark:to-yellow-900/8 hover:from-amber-50/70 hover:to-yellow-50/60 ${ownerStyle?.border || "border-l-transparent"}`
        : `border-gray-100/50 dark:border-gray-800/15 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 ${ownerStyle?.border || "border-l-transparent"}`
    }`}>
      <div className="flex items-center gap-2 min-w-0 pr-2">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[task.status] }} />
        <Link href={`/tasks/${task.id}`} className="text-sm text-gray-700 dark:text-gray-200 hover:text-indigo-500 truncate transition-all duration-200">{task.title}</Link>
        {(task.subtasks?.length || 0) > 0 && <span className="text-[9px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded flex-shrink-0">{task.subtasks!.length}</span>}
        {(task.deliverables?.length || 0) > 0 && <HiOutlinePaperClip className="w-3 h-3 text-blue-500 flex-shrink-0" />}
        {(task.feedback?.length || 0) > 0 && <HiOutlineChatAlt className="w-3 h-3 text-violet-400 flex-shrink-0" />}
        {isOverdue && <span className="text-[8px] font-bold text-red-500 bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded flex-shrink-0">OVERDUE</span>}
        {isDueToday && <span className="text-[8px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded flex-shrink-0">DUE TODAY</span>}
        {needsReview && <span className="text-[8px] font-bold text-blue-600 bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded flex-shrink-0">NEEDS REVIEW</span>}
        {needsAck && <span className="text-[8px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded flex-shrink-0">ACTION REQ</span>}
      </div>
      {/* Owner — only Leah or Chloe, color coded */}
      {editable ? (
        <select value={task.owner_id || ""} onChange={(e) => onUpdate(task.id, "owner_id", e.target.value)}
          className={`text-[11px] font-medium bg-transparent border-0 cursor-pointer w-full truncate ${ownerStyle?.text || "text-gray-500"}`}>
          <option value="" className="bg-white dark:bg-gray-900">—</option>
          {owners.map((o) => <option key={o.id} value={o.id} className="bg-white dark:bg-gray-900">{o.full_name}</option>)}
        </select>
      ) : (
        <span className={`text-[11px] font-medium truncate ${ownerStyle?.text || "text-gray-500"}`}>{ownerName || "—"}</span>
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
      <div className="flex items-center gap-1">
        {editable ? (
          <input type="date" value={task.deadline || ""} onChange={(e) => onUpdate(task.id, "deadline", e.target.value)}
            className={`text-[11px] bg-transparent border-0 cursor-pointer w-full ${isOverdue ? "text-red-500 font-medium" : isDueToday ? "text-amber-600 font-medium" : "text-gray-500 dark:text-gray-400"}`} />
        ) : (
          <span className={`text-[11px] ${isOverdue ? "text-red-500 font-medium" : isDueToday ? "text-amber-600 font-medium" : "text-gray-500"}`}>{task.deadline || "—"}</span>
        )}
      </div>
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
