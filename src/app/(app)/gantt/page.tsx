"use client";

import { useState, useMemo, useRef } from "react";
import { useApi, apiPatch, apiPost } from "@/lib/use-api";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import type { Task, TaskStatus, Dependency } from "@/lib/types";
import Link from "next/link";
import { HiChevronDown, HiChevronRight, HiViewGrid, HiViewList, HiCalendar, HiZoomIn, HiZoomOut, HiExclamationCircle } from "react-icons/hi";

type FullTask = Task & { subtasks?: { id: string; title: string; status: TaskStatus }[]; owner?: { full_name: string } };
type Iter = { id: string; name: string; iteration_number: number; start_date: string; end_date: string; weeks?: { id: string; week_number: number; start_date: string; end_date: string }[] };
type Quarter = { id: string; name: string; start_date: string; end_date: string; iterations: Iter[] };
type ViewMode = "overall" | "iteration" | "week";

const FIXED_CATS = ["Customer Success & PG Acquisition", "Product / Engineering / Workflows", "Cybersecurity", "Continuous Learning", "Talent Acquisition", "Branding"];
const CAT_COLORS: Record<string, string> = {
  "Customer Success & PG Acquisition": "#6366f1", "Product / Engineering / Workflows": "#3b82f6",
  "Cybersecurity": "#ef4444", "Continuous Learning": "#f59e0b", "Talent Acquisition": "#10b981", "Branding": "#8b5cf6",
};
const CAT_SHORT: Record<string, string> = {
  "Customer Success & PG Acquisition": "CS & PG", "Product / Engineering / Workflows": "Engineering",
  "Cybersecurity": "Cyber", "Continuous Learning": "Learning", "Talent Acquisition": "Talent", "Branding": "Brand",
};

// Owner-based border colors for task bars
const OWNER_COLORS: Record<string, { border: string; bg: string; label: string }> = {
  "Leah": { border: "#ec4899", bg: "rgba(236,72,153,0.15)", label: "text-pink-500" },
  "Chloe": { border: "#06b6d4", bg: "rgba(6,182,212,0.15)", label: "text-cyan-500" },
};

function daysBetween(a: string, b: string) { return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000); }
function fmt(d: string) { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); }

export default function GanttPage() {
  const { data: tasks, setData: setTasks } = useApi<FullTask[]>("/api/tasks");
  const { data: deps } = useApi<Dependency[]>("/api/dependencies");
  const { data: quarters } = useApi<Quarter[]>("/api/quarters");

  const [viewMode, setViewMode] = useState<ViewMode>("overall");
  const [selectedIter, setSelectedIter] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(FIXED_CATS));
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hoveredTask, setHoveredTask] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; task: FullTask } | null>(null);
  const [showDepModal, setShowDepModal] = useState(false);
  const [depFrom, setDepFrom] = useState("");
  const [depTo, setDepTo] = useState("");
  const timelineRef = useRef<HTMLDivElement>(null);

  const all = tasks || [];
  const allDeps = deps || [];
  const quarter = quarters?.[0];
  const iterations = quarter?.iterations || [];

  // Blocking / blocked task IDs
  const blockedTaskIds = new Set(allDeps.map((d) => d.task_id));
  const blockingTaskIds = new Set(allDeps.map((d) => d.depends_on_task_id));

  const filteredTasks = useMemo(() => {
    if (viewMode === "iteration" && selectedIter) return all.filter((t) => t.iteration_id === selectedIter);
    if (viewMode === "week" && selectedWeek) return all.filter((t) => t.week_id === selectedWeek);
    return all;
  }, [all, viewMode, selectedIter, selectedWeek]);

  const { chartStart, chartEnd } = useMemo(() => {
    if (viewMode === "iteration" && selectedIter) {
      const iter = iterations.find((i) => i.id === selectedIter);
      if (iter) return { chartStart: iter.start_date, chartEnd: iter.end_date };
    }
    if (viewMode === "week" && selectedWeek) {
      const week = iterations.flatMap((i) => i.weeks || []).find((w) => w.id === selectedWeek);
      if (week) return { chartStart: week.start_date, chartEnd: week.end_date };
    }
    return { chartStart: quarter?.start_date || "2026-04-06", chartEnd: quarter?.end_date || "2026-07-04" };
  }, [viewMode, selectedIter, selectedWeek, iterations, quarter]);

  const baseDayW = viewMode === "week" ? 40 : viewMode === "iteration" ? 16 : 8;
  const DAY_W = baseDayW * zoomLevel;
  const ROW_H = 30;
  const HEADER_H = 52;
  const totalDays = daysBetween(chartStart, chartEnd) + 3;

  const toggle = (cat: string) => { const n = new Set(expandedCats); n.has(cat) ? n.delete(cat) : n.add(cat); setExpandedCats(n); };

  type RowItem = { type: "category" | "separator" | "task"; cat?: string; task?: FullTask; depth: number; label?: string };
  const rows: RowItem[] = [];
  FIXED_CATS.forEach((cat) => {
    const catTasks = filteredTasks.filter((t) => t.category === cat);
    // Hide empty categories when filtering by iteration or week
    if (catTasks.length === 0 && viewMode !== "overall") return;
    rows.push({ type: "category", cat, depth: 0 });
    if (expandedCats.has(cat) && catTasks.length > 0) {
      // Sort: iteration goals first (by iteration + start_date), then weekly tasks (by week + start_date)
      const goals = catTasks.filter((t) => !t.week_id).sort((a, b) => {
        const ia = iterations.findIndex((i) => i.id === a.iteration_id);
        const ib = iterations.findIndex((i) => i.id === b.iteration_id);
        if (ia !== ib) return ia - ib;
        return (a.start_date || "").localeCompare(b.start_date || "");
      });
      const weekTasks = catTasks.filter((t) => !!t.week_id).sort((a, b) => {
        const findWeekOrder = (weekId: string | undefined) => {
          if (!weekId) return 999;
          for (let ii = 0; ii < iterations.length; ii++) {
            const w = (iterations[ii].weeks || []).find((w) => w.id === weekId);
            if (w) return ii * 10 + w.week_number;
          }
          return 999;
        };
        const waNum = findWeekOrder(a.week_id);
        const wbNum = findWeekOrder(b.week_id);
        if (waNum !== wbNum) return waNum - wbNum;
        return (a.start_date || "").localeCompare(b.start_date || "");
      });

      if (goals.length > 0) {
        goals.forEach((task) => rows.push({ type: "task", task, cat, depth: 1 }));
      }
      if (weekTasks.length > 0 && goals.length > 0) {
        rows.push({ type: "separator", cat, depth: 1, label: "Weekly Tasks" });
      }
      if (weekTasks.length > 0) {
        weekTasks.forEach((task) => rows.push({ type: "task", task, cat, depth: 1 }));
      }
    }
  });

  // Timeline headers — dual row (months on top, weeks/days below)
  const topHeaders: { label: string; x: number; w: number }[] = [];
  const bottomHeaders: { label: string; x: number; isMajor: boolean }[] = [];

  if (viewMode === "week") {
    // Day-level
    let d = new Date(chartStart);
    while (d <= new Date(chartEnd)) {
      const ds = d.toISOString().split("T")[0];
      const x = daysBetween(chartStart, ds) * DAY_W;
      bottomHeaders.push({ label: d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }), x, isMajor: d.getDay() === 1 });
      d.setDate(d.getDate() + 1);
    }
  } else {
    // Week-level ticks
    let d = new Date(chartStart);
    let curMonth = "";
    let monthStart = 0;
    while (d <= new Date(chartEnd)) {
      const ds = d.toISOString().split("T")[0];
      const x = daysBetween(chartStart, ds) * DAY_W;
      const month = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      if (month !== curMonth) {
        if (curMonth) topHeaders.push({ label: curMonth, x: monthStart, w: x - monthStart });
        curMonth = month; monthStart = x;
      }
      if (d.getDay() === 1 || d.getDate() === 1) {
        bottomHeaders.push({ label: fmt(ds), x, isMajor: d.getDate() <= 7 });
      }
      d.setDate(d.getDate() + 1);
    }
    if (curMonth) topHeaders.push({ label: curMonth, x: monthStart, w: totalDays * DAY_W - monthStart });
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const todayX = daysBetween(chartStart, todayStr) * DAY_W;

  // Drag
  const handleDrag = (taskId: string, type: "move" | "resize") => (e: React.MouseEvent) => {
    e.preventDefault();
    const task = all.find((t) => t.id === taskId);
    if (!task) return;
    const startX = e.clientX;
    const origStart = task.start_date || chartStart;
    const origEnd = task.end_date || chartStart;
    const onMove = () => {};
    const onUp = async (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const daysDelta = Math.round(dx / DAY_W);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (daysDelta === 0) return;
      const addDays = (ds: string, n: number) => { const dt = new Date(ds); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; };
      const updates = type === "move" ? { start_date: addDays(origStart, daysDelta), end_date: addDays(origEnd, daysDelta) } : { end_date: addDays(origEnd, daysDelta) };
      setTasks((prev) => prev ? prev.map((t) => t.id === taskId ? { ...t, ...updates } : t) : prev);
      try { await apiPatch(`/api/tasks/${taskId}`, updates); } catch {}
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  async function addDep() {
    if (!depFrom || !depTo || depFrom === depTo) return;
    try { await apiPost("/api/dependencies", { task_id: depFrom, depends_on_task_id: depTo }); setShowDepModal(false); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  if (!quarter) return (
    <div className="p-8 text-center animate-fade-in">
      <p className="text-gray-500 mb-3">No data yet.</p>
      <Link href="/upload" className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm rounded-xl">Upload CSV</Link>
    </div>
  );

  const completedCount = filteredTasks.filter((t) => t.status === "completed").length;
  const inProgressCount = filteredTasks.filter((t) => t.status === "in_progress").length;
  const blockedCount = filteredTasks.filter((t) => t.status === "blocked").length;

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold gradient-text">Roadmap</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {quarter.name} &middot; {fmt(chartStart)} — {fmt(chartEnd)} &middot;
            <span className="text-green-500 ml-1">{completedCount} done</span> &middot;
            <span className="text-blue-500">{inProgressCount} active</span>
            {blockedCount > 0 && <span className="text-red-500"> &middot; {blockedCount} obstacles</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            <button onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))} className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"><HiZoomOut className="w-4 h-4" /></button>
            <span className="text-[10px] text-gray-500 w-10 text-center">{Math.round(zoomLevel * 100)}%</span>
            <button onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))} className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"><HiZoomIn className="w-4 h-4" /></button>
          </div>
          <button onClick={() => setShowDepModal(true)} className="px-3 py-1.5 text-xs bg-gradient-to-r from-indigo-500/10 to-violet-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl hover:from-indigo-500/20 hover:to-violet-500/20 transition-all">
            + Dependency
          </button>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* View mode */}
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-0.5">
          {([
            { mode: "overall" as ViewMode, label: "Portfolio", icon: HiViewGrid },
            { mode: "iteration" as ViewMode, label: "Sprint", icon: HiViewList },
            { mode: "week" as ViewMode, label: "Weekly", icon: HiCalendar },
          ]).map(({ mode, label, icon: Icon }) => (
            <button key={mode} onClick={() => { setViewMode(mode); if (mode === "overall") { setSelectedIter(null); setSelectedWeek(null); } }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${viewMode === mode ? "bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>

        {viewMode === "iteration" && (
          <div className="flex gap-1.5">
            {iterations.map((iter) => (
              <button key={iter.id} onClick={() => setSelectedIter(iter.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-all ${selectedIter === iter.id ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50"}`}>
                {iter.name} <span className="text-[9px] opacity-70">({fmt(iter.start_date)})</span>
              </button>
            ))}
          </div>
        )}

        {viewMode === "week" && (
          <div className="flex gap-1.5 flex-wrap">
            {iterations.map((iter) => (
              <div key={iter.id} className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 mr-0.5">{iter.name}:</span>
                {(iter.weeks || []).map((w) => (
                  <button key={w.id} onClick={() => setSelectedWeek(w.id)}
                    className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-all ${selectedWeek === w.id ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm" : "bg-white dark:bg-gray-800 text-gray-500 border border-gray-200/60 dark:border-gray-700/60 hover:bg-gray-50"}`}>
                    W{w.week_number}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Category legend */}
        <div className="flex items-center gap-3 ml-auto">
          {FIXED_CATS.map((cat) => {
            const ct = filteredTasks.filter((t) => t.category === cat);
            if (ct.length === 0) return null;
            return (
              <button key={cat} onClick={() => toggle(cat)}
                className={`flex items-center gap-1 text-[10px] transition-all ${expandedCats.has(cat) ? "text-gray-700 dark:text-gray-300" : "text-gray-400 line-through"}`}>
                <span className="w-2.5 h-1.5 rounded-sm" style={{ backgroundColor: CAT_COLORS[cat] }} />
                {CAT_SHORT[cat]} <span className="text-gray-400">({ct.length})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Status legend */}
      <div className="flex items-center gap-4 text-[10px] text-gray-500">
        {(Object.entries(STATUS_LABELS) as [TaskStatus, string][]).map(([s, l]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: STATUS_COLORS[s] }} />{l}
          </span>
        ))}
        <span className="flex items-center gap-1 ml-2"><span className="w-3 h-2 rounded-sm" style={{ background: "linear-gradient(135deg, #f59e0b, #b45309)" }} />◆ Goal</span>
        <span className="flex items-center gap-1 ml-2"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: "#ec4899" }} /><span className="text-pink-500">Leah</span></span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: "#06b6d4" }} /><span className="text-cyan-500">Chloe</span></span>
        <span className="flex items-center gap-1 text-violet-500">○→● Prerequisite</span>
        <span className="flex items-center gap-1 text-red-500">○→● Obstacle (overdue)</span>
      </div>

      {/* Gantt Chart */}
      <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-lg overflow-hidden flex">
        {/* Left panel — sticky */}
        <div className="w-80 flex-shrink-0 border-r border-gray-200/60 dark:border-gray-800/60 bg-white/95 dark:bg-gray-900/95 z-10">
          <div className="sticky top-0 h-[52px] border-b border-gray-200/60 dark:border-gray-800/60 px-4 flex items-end pb-2 bg-white/95 dark:bg-gray-900/95 z-10">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Category / Task</span>
            <span className="text-[10px] text-gray-400 ml-auto">Owner</span>
          </div>
          {rows.map((row, i) => (
            <div key={i}
              className={`flex items-center border-b transition-all duration-150 ${
                row.type === "category"
                  ? "border-gray-200/60 dark:border-gray-700/40 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800/40 dark:to-gray-800/20"
                  : row.type === "separator"
                  ? "border-gray-100/40 dark:border-gray-800/20 bg-gray-50/30 dark:bg-gray-800/10"
                  : `border-gray-100/60 dark:border-gray-800/20 ${hoveredTask === row.task?.id ? "bg-indigo-50/60 dark:bg-indigo-900/15" : "hover:bg-gray-50/80 dark:hover:bg-gray-800/20"}`
              }`}
              style={{ height: row.type === "separator" ? 20 : ROW_H, paddingLeft: row.type === "category" ? 12 : 28 }}
              onMouseEnter={() => row.task && setHoveredTask(row.task.id)}
              onMouseLeave={() => setHoveredTask(null)}>
              {row.type === "category" ? (
                <button onClick={() => toggle(row.cat!)} className="flex items-center gap-2 w-full text-left pr-3">
                  {expandedCats.has(row.cat!) ? <HiChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <HiChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                  <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: CAT_COLORS[row.cat!] }} />
                  <span className="text-[11px] font-semibold text-gray-800 dark:text-white truncate">{row.cat}</span>
                  <span className="text-[9px] text-gray-400 ml-auto font-medium">{filteredTasks.filter((t) => t.category === row.cat).length}</span>
                </button>
              ) : row.type === "separator" ? (
                <span className="text-[8px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{row.label}</span>
              ) : (
                <div className="flex items-center gap-2 w-full pr-3">
                  {!row.task!.week_id ? (
                    <span className="text-[7px] text-amber-500 flex-shrink-0">◆</span>
                  ) : (
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[row.task!.status] }} />
                  )}
                  {blockedTaskIds.has(row.task!.id) && <HiExclamationCircle className="w-3 h-3 text-orange-400 flex-shrink-0" title="Has prerequisite" />}
                  <Link href={`/tasks/${row.task!.id}`} className={`text-[10px] hover:text-indigo-500 truncate transition-colors flex-1 ${!row.task!.week_id ? "text-amber-700 dark:text-amber-400 font-medium" : "text-gray-700 dark:text-gray-300"}`} title={row.task!.title}>
                    {row.task!.title}
                  </Link>
                  <span className={`text-[8px] flex-shrink-0 w-12 text-right truncate font-medium ${OWNER_COLORS[row.task!.owner?.full_name || ""]?.label || "text-gray-400"}`}>{row.task!.owner?.full_name || ""}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right panel — timeline */}
        <div className="flex-1 overflow-x-auto" ref={timelineRef}>
          <div style={{ width: Math.max(totalDays * DAY_W, 600), minWidth: "100%" }}>
            {/* Dual-row header */}
            <div className="sticky top-0 z-10 bg-white/95 dark:bg-gray-900/95 border-b border-gray-200/60 dark:border-gray-800/60" style={{ height: HEADER_H }}>
              {/* Top row — months */}
              {topHeaders.map((h, i) => (
                <div key={i} className="absolute top-0 flex items-center px-3 border-r border-gray-200/40 dark:border-gray-700/30 text-[10px] font-semibold text-gray-600 dark:text-gray-400"
                  style={{ left: h.x, width: h.w, height: HEADER_H / 2 }}>
                  {h.label}
                </div>
              ))}
              {/* Bottom row — weeks/days */}
              {bottomHeaders.map((h, i) => (
                <div key={i} className={`absolute flex items-end pb-1 px-0.5 text-[8px] ${h.isMajor ? "text-gray-600 dark:text-gray-400 font-medium" : "text-gray-400/60 dark:text-gray-600/60"}`}
                  style={{ left: h.x, top: HEADER_H / 2, height: HEADER_H / 2 }}>
                  {h.label}
                </div>
              ))}
              {/* Iteration bands in overall view */}
              {viewMode === "overall" && iterations.map((iter, idx) => {
                const x = daysBetween(chartStart, iter.start_date) * DAY_W;
                const w = daysBetween(iter.start_date, iter.end_date) * DAY_W;
                return (
                  <div key={iter.id} className="absolute bottom-0 flex items-center justify-center text-[8px] font-bold uppercase tracking-widest border-r"
                    style={{ left: x, width: w, height: 14, backgroundColor: idx % 2 === 0 ? "rgba(99,102,241,0.06)" : "rgba(99,102,241,0.02)", borderColor: "rgba(99,102,241,0.1)", color: "rgba(99,102,241,0.4)" }}>
                    {iter.name}
                  </div>
                );
              })}
            </div>

            {/* Task rows */}
            <div className="relative">
              {/* Grid lines */}
              {bottomHeaders.filter((h) => h.isMajor).map((h, i) => (
                <div key={i} className="absolute top-0 bottom-0 border-l border-gray-100/80 dark:border-gray-800/30" style={{ left: h.x }} />
              ))}

              {/* Today marker */}
              {todayX > 0 && todayX < totalDays * DAY_W && (
                <div className="absolute top-0 bottom-0 z-20" style={{ left: todayX }}>
                  <div className="w-0.5 h-full bg-gradient-to-b from-red-500 via-red-400 to-transparent" />
                  <div className="absolute -top-1 -left-2 px-1.5 py-0.5 bg-red-500 text-white text-[7px] font-bold rounded-b shadow-sm">TODAY</div>
                </div>
              )}

              {rows.map((row, i) => {
                if (row.type === "separator") {
                  return <div key={i} className="border-b border-gray-100/30 dark:border-gray-800/10 bg-gray-50/20 dark:bg-gray-800/5" style={{ height: 20 }} />;
                }
                if (row.type === "category") {
                  return <div key={i} className="border-b border-gray-200/40 dark:border-gray-700/20 bg-gradient-to-r from-gray-50/50 to-transparent dark:from-gray-800/10" style={{ height: ROW_H }} />;
                }

                const task = row.task!;
                const sDate = task.start_date || chartStart;
                const eDate = task.end_date || sDate;
                const x = Math.max(daysBetween(chartStart, sDate) * DAY_W, 0);
                const w = Math.max(daysBetween(sDate, eDate) * DAY_W, DAY_W * 2);
                const catColor = CAT_COLORS[task.category || ""] || "#6366f1";
                const isBlocked = blockedTaskIds.has(task.id);
                const isHovered = hoveredTask === task.id;
                const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== "completed";
                const isIterationGoal = !task.week_id;
                const ownerName = task.owner?.full_name || "";
                const ownerStyle = OWNER_COLORS[ownerName];

                return (
                  <div key={i}
                    className={`relative border-b transition-all duration-150 ${isHovered ? "bg-indigo-50/40 dark:bg-indigo-900/10" : ""} border-gray-100/40 dark:border-gray-800/15`}
                    style={{ height: ROW_H }}
                    onMouseEnter={() => setHoveredTask(task.id)}
                    onMouseLeave={() => { setHoveredTask(null); setTooltip(null); }}>
                    <div
                      className={`absolute cursor-grab active:cursor-grabbing group transition-all duration-150 ${
                        isIterationGoal
                          ? `rounded-lg ${isHovered ? "shadow-lg ring-1 ring-amber-300/40 scale-y-110" : "shadow-sm hover:shadow-md"}`
                          : `rounded-md ${isHovered ? "shadow-lg ring-1 ring-indigo-300/30 dark:ring-indigo-600/20 scale-y-110" : "shadow-sm hover:shadow-md"}`
                      }`}
                      style={{ left: x, width: w, top: isIterationGoal ? 3 : 4, height: isIterationGoal ? ROW_H - 6 : ROW_H - 10, borderBottom: ownerStyle ? `2.5px solid ${ownerStyle.border}` : undefined }}
                      onMouseDown={handleDrag(task.id, "move")}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltip({ x: rect.left + rect.width / 2, y: rect.top - 8, task });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      {isIterationGoal ? (
                        <>
                          {/* Golden glass gradient for iteration goals */}
                          <div className="absolute inset-0 rounded-lg" style={{
                            background: "linear-gradient(135deg, #f59e0b, #d97706, #b45309)",
                            opacity: isHovered ? 0.95 : 0.85,
                          }} />
                          <div className="absolute inset-0 rounded-lg" style={{
                            background: "linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 60%)",
                          }} />
                          {/* Left accent — darker gold */}
                          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg" style={{ backgroundColor: "#92400e" }} />
                          {/* Diamond icon for goal */}
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[7px] text-amber-100">◆</span>
                        </>
                      ) : (
                        <>
                          {/* Standard status bar for weekly tasks */}
                          <div className="absolute inset-0 rounded-md" style={{ backgroundColor: STATUS_COLORS[task.status], opacity: isHovered ? 0.95 : 0.8 }} />
                          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md" style={{ backgroundColor: catColor }} />
                        </>
                      )}
                      {/* Progress overlay */}
                      {task.progress > 0 && <div className="absolute top-0 bottom-0 left-0 rounded-l-md bg-white/15" style={{ width: `${task.progress}%` }} />}
                      {/* Overdue indicator */}
                      {isOverdue && <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border border-white dark:border-gray-900 animate-pulse-subtle" />}
                      {/* Dependency indicator */}
                      {isBlocked && <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-orange-400 border border-white dark:border-gray-900" />}
                      {/* Label */}
                      {w > DAY_W * 4 && (
                        <span className={`relative font-medium px-2 truncate block ${isIterationGoal ? "text-[8px] text-amber-50 pl-5" : "text-[8px] text-white"}`}
                          style={{ lineHeight: `${isIterationGoal ? ROW_H - 6 : ROW_H - 10}px` }}>
                          {task.title}
                        </span>
                      )}
                      {/* Resize handle */}
                      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/30 rounded-r-md transition-opacity"
                        onMouseDown={(e) => { e.stopPropagation(); handleDrag(task.id, "resize")(e); }} />
                    </div>
                  </div>
                );
              })}

              {/* Dependency connectors — clean right-angle style */}
              <svg className="absolute inset-0 pointer-events-none" style={{ width: totalDays * DAY_W, height: rows.length * ROW_H }}>
                <defs>
                  <linearGradient id="dep-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.7" />
                  </linearGradient>
                  <linearGradient id="dep-grad-block" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#f97316" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity="0.7" />
                  </linearGradient>
                  <filter id="dep-glow">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                {allDeps.map((dep) => {
                  // fromTask = PREREQUISITE (must finish first)
                  // toTask = DEPENDENT (waits for prerequisite)
                  const prereqIdx = rows.findIndex((r) => r.type === "task" && r.task?.id === dep.depends_on_task_id);
                  const depIdx = rows.findIndex((r) => r.type === "task" && r.task?.id === dep.task_id);
                  if (prereqIdx < 0 || depIdx < 0) return null;
                  const prereqTask = rows[prereqIdx].task!;
                  const depTask = rows[depIdx].task!;

                  // Arrow: prerequisite end → dependent start
                  const x1 = daysBetween(chartStart, prereqTask.end_date || chartStart) * DAY_W;
                  const y1 = prereqIdx * ROW_H + ROW_H / 2;
                  const x2 = daysBetween(chartStart, depTask.start_date || chartStart) * DAY_W;
                  const y2 = depIdx * ROW_H + ROW_H / 2;

                  // Prerequisite logic:
                  // Default: all relationships are "prerequisite" (violet)
                  // Becomes "obstacle" (red) ONLY when prerequisite is past deadline AND not completed
                  const prereqDone = prereqTask.status === "completed";
                  const prereqOverdue = prereqTask.deadline && new Date(prereqTask.deadline) < new Date() && !prereqDone;
                  const isObstacle = prereqOverdue; // past due + not done = obstacle
                  const isHighlighted = hoveredTask === dep.task_id || hoveredTask === dep.depends_on_task_id;

                  const gap = Math.max((x2 - x1) / 2, 14);
                  const midX = x1 + gap;
                  const path = y1 === y2
                    ? `M${x1},${y1} L${x2},${y2}`
                    : `M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}`;

                  // Prerequisite = violet/indigo, Obstacle = red
                  const lineColor = isObstacle ? "url(#dep-grad-block)" : "url(#dep-grad)";
                  const accentColor = isObstacle ? "#ef4444" : "#8b5cf6";
                  const labelMidX = (x1 + x2) / 2;
                  const labelMidY = Math.min(y1, y2) - 6;
                  const statusLabel = prereqDone ? "✓ Done" : isObstacle ? "🔴 Obstacle" : "Prerequisite";

                  return (
                    <g key={dep.id} style={{ transition: "opacity 0.3s" }} opacity={isHighlighted ? 1 : 0.45}>
                      {/* Glow on hover */}
                      {isHighlighted && (
                        <path d={path} fill="none" stroke={accentColor} strokeWidth={7} opacity={0.08} strokeLinecap="round" strokeLinejoin="round" />
                      )}
                      {/* Main connector */}
                      <path d={path} fill="none" stroke={lineColor} strokeWidth={isHighlighted ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" />
                      {/* Source circle (prerequisite end) */}
                      <circle cx={x1} cy={y1} r={isHighlighted ? 3.5 : 2.5} fill="none" stroke={accentColor} strokeWidth={1.5} opacity={isHighlighted ? 1 : 0.6} />
                      {/* Target circle + arrow (dependent start) */}
                      <circle cx={x2} cy={y2} r={isHighlighted ? 4 : 3} fill={accentColor} opacity={isHighlighted ? 1 : 0.7} />
                      <polygon points={`${x2 - 7},${y2 - 4} ${x2 - 1},${y2} ${x2 - 7},${y2 + 4}`} fill={accentColor} opacity={isHighlighted ? 0.9 : 0.6} />
                      {/* Hover label */}
                      {isHighlighted && (
                        <g>
                          <rect x={labelMidX - 80} y={labelMidY - 12} width={160} height={18} rx={5} fill="rgba(15,23,42,0.9)" />
                          <text x={labelMidX} y={labelMidY + 1} textAnchor="middle" fill="white" fontSize="7.5" fontWeight="600" fontFamily="system-ui">
                            {statusLabel}: {prereqTask.title.substring(0, 15)}… → {depTask.title.substring(0, 15)}…
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="fixed z-50 pointer-events-none animate-fade-in"
          style={{ left: Math.min(tooltip.x, window.innerWidth - 280), top: tooltip.y - 90 }}>
          <div className="bg-gray-900/95 dark:bg-gray-800/95 backdrop-blur-xl text-white rounded-xl px-4 py-3 shadow-2xl border border-gray-700/50 max-w-[260px]">
            <p className="text-xs font-semibold truncate">{tooltip.task.title}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: STATUS_COLORS[tooltip.task.status] + "30", color: STATUS_COLORS[tooltip.task.status] }}>
                {STATUS_LABELS[tooltip.task.status]}
              </span>
              {tooltip.task.owner && <span className="text-[10px] text-gray-400">{tooltip.task.owner.full_name}</span>}
            </div>
            <div className="flex gap-3 mt-1.5 text-[9px] text-gray-400">
              <span>{fmt(tooltip.task.start_date || "")} → {fmt(tooltip.task.end_date || "")}</span>
              {tooltip.task.deadline && <span>Due: {fmt(tooltip.task.deadline)}</span>}
            </div>
            {tooltip.task.category && <span className="text-[9px] text-gray-500 mt-1 block">{tooltip.task.category}</span>}
          </div>
        </div>
      )}

      {/* Dependency Modal */}
      {showDepModal && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/60 dark:border-gray-700/60 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl animate-scale-in">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Add Dependency</h2>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Task</label>
              <select value={depFrom} onChange={(e) => setDepFrom(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white">
                <option value="">Select...</option>
                {FIXED_CATS.map((cat) => (
                  <optgroup key={cat} label={cat}>
                    {all.filter((t) => t.category === cat).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Depends on</label>
              <select value={depTo} onChange={(e) => setDepTo(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white">
                <option value="">Select...</option>
                {FIXED_CATS.map((cat) => (
                  <optgroup key={cat} label={cat}>
                    {all.filter((t) => t.category === cat && t.id !== depFrom).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowDepModal(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all">Cancel</button>
              <button onClick={addDep} disabled={!depFrom || !depTo}
                className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-sm rounded-xl shadow-md transition-all active:scale-[0.97]">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
