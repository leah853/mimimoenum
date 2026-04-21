"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useApi } from "@/lib/use-api";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import type { Task, TaskStatus } from "@/lib/types";
import { HiChevronDown, HiChevronRight, HiOutlineChatAlt, HiOutlinePaperClip, HiPlus } from "react-icons/hi";
import { SkeletonRows, EmptyState } from "@/components/ui";
import OwnerMaps from "@/components/OwnerMaps";

type FullTask = Task & { subtasks?: { id: string; title: string; status: TaskStatus }[]; deliverables?: { id: string }[]; feedback?: { id: string }[]; owner?: { id: string; full_name: string } };
type WeekOption = { id: string; week_number: number; start_date: string; end_date: string };
type IterOption = { id: string; name: string; start_date: string; end_date: string; weeks?: WeekOption[] };
type QuarterOption = { id: string; name: string; start_date: string; end_date: string; iterations: IterOption[] };

import { FIXED_CATEGORIES, OWNER_STYLE } from "@/lib/constants";
import { calcScore, formatDate } from "@/lib/utils";

// Display aliases requested by reps — the user-facing name shown in Owner Map,
// while the data keeps the canonical category name from FIXED_CATEGORIES.
const CATEGORY_ALIAS: Record<string, string> = {
  "Customer Success & PG Acquisition": "Vertical Execution & Customer Success",
  "Product / Engineering / Workflows": "Workflow / Product / Engineering",
  "Cybersecurity": "Cybersecurity",
  "Branding": "Branding",
  "Continuous Learning": "Knowledge & Culture",
  "Talent Acquisition": "Talent Acquisition",
};

function ScorePill({ tasks, size = "sm" }: { tasks: Task[]; size?: "sm" | "lg" }) {
  const s = calcScore(tasks);
  const bg = s >= 7 ? "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400" : s > 0 ? "bg-yellow-100 dark:bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
  const cls = size === "lg" ? "text-sm font-bold px-2.5 py-1" : "text-[10px] font-bold px-1.5 py-0.5";
  return <span className={`rounded-full ${bg} ${cls} transition-all duration-200`}>{s.toFixed(1)}/10</span>;
}

export default function MilestonesPage() {
  const { data: tasks, loading } = useApi<FullTask[]>("/api/tasks");
  const { data: quarters } = useApi<QuarterOption[]>("/api/quarters");
  const { data: goals } = useApi<{ id: string; category: string; goal: string }[]>("/api/quarter-goals");
  const [expandedIters, setExpandedIters] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState<"timeline" | "owner_map" | "owner_maps">("timeline");

  const all = tasks || [];
  const quarter = quarters?.[0];
  const iterations = quarter?.iterations || [];
  const categories = useMemo(() => [...new Set([...FIXED_CATEGORIES, ...all.map((t) => t.category).filter(Boolean)])] as string[], [all]);

  // Auto-expand on first load
  if (!initialized && iterations.length > 0) {
    queueMicrotask(() => { setExpandedIters(new Set(iterations.map((i) => i.id))); setInitialized(true); });
  }

  if (loading) return (
    <div className="p-8 space-y-4 animate-fade-in">
      <div className="skeleton h-8 w-56" />
      <div className="skeleton h-12 w-full rounded-2xl" />
      <SkeletonRows count={6} />
    </div>
  );

  if (!loading && all.length === 0) return (
    <div className="p-8"><EmptyState title="No milestones yet" description="Tasks will appear here once added to the system." /></div>
  );

  const toggleIter = (id: string) => { const n = new Set(expandedIters); n.has(id) ? n.delete(id) : n.add(id); setExpandedIters(n); };
  const expandAll = () => setExpandedIters(new Set(iterations.map((i) => i.id)));
  const collapseAll = () => setExpandedIters(new Set());

  function tasksFor(iterationId: string, cat: string) { return all.filter((t) => t.iteration_id === iterationId && t.category === cat && !t.week_id); }
  function catTasks(cat: string) { return all.filter((t) => t.category === cat); }
  function weekTasks(weekId: string, cat: string) { return all.filter((t) => t.week_id === weekId && t.category === cat); }

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Milestones</h1>
          <p className="text-xs text-gray-500 mt-1">
            {quarter?.name || "Q2 2026"} &middot; {quarter ? `${formatDate(quarter.start_date)} — ${formatDate(quarter.end_date)}` : ""} &middot; {all.length} tasks
          </p>
        </div>
        {activeTab === "timeline" && (
          <div className="flex gap-2">
            <button onClick={expandAll} className="px-3 py-1.5 text-xs bg-gradient-to-r from-indigo-500/10 to-violet-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl hover:from-indigo-500/20 hover:to-violet-500/20 transition-all duration-200">Expand All</button>
            <button onClick={collapseAll} className="px-3 py-1.5 text-xs bg-gradient-to-r from-indigo-500/10 to-violet-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl hover:from-indigo-500/20 hover:to-violet-500/20 transition-all duration-200">Collapse All</button>
          </div>
        )}
      </div>

      {/* Tabs: Timeline / By Owner (Tasks) / Owner Maps */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        <button onClick={() => setActiveTab("timeline")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${activeTab === "timeline" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          Timeline
        </button>
        <button onClick={() => setActiveTab("owner_map")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${activeTab === "owner_map" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          By Owner (Tasks)
        </button>
        <button onClick={() => setActiveTab("owner_maps")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${activeTab === "owner_maps" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          Owner Maps
        </button>
      </div>

      {activeTab === "owner_map" && <OwnerMap categories={categories} tasks={all} />}

      {activeTab === "owner_maps" && <OwnerMaps />}

      {activeTab === "timeline" && (all.length === 0 ? (
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-8 text-center">
          <p className="text-gray-500 mb-3">No data yet. Upload a CSV or create tasks first.</p>
          <Link href="/upload" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg mr-2 transition-all duration-200">Upload CSV</Link>
          <Link href="/tasks" className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm rounded-lg transition-all duration-200">Go to Tasks</Link>
        </div>
      ) : (
        <div className="border border-gray-200/60 dark:border-gray-800/60 rounded-2xl overflow-auto bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm shadow-sm">
          <table className="w-full border-collapse" style={{ minWidth: 1200 }}>
            <thead>
              <tr className="border-b border-gray-300 dark:border-gray-700">
                <th className="sticky left-0 z-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-48 min-w-[192px] border-r border-gray-200/60 dark:border-gray-800/60">Timeline</th>
                {categories.map((cat) => (
                  <th key={cat} className="text-left px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[180px] border-r border-gray-100 dark:border-gray-800/50 last:border-r-0">
                    <div className="flex items-center justify-between">
                      <span className="truncate">{cat}</span>
                      <ScorePill tasks={catTasks(cat)} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Quarter row */}
              <tr className="bg-gradient-to-r from-gray-100 to-gray-50 dark:from-gray-800/60 dark:to-gray-800/30 border-b border-gray-300 dark:border-gray-700">
                <td className="sticky left-0 z-10 bg-gradient-to-r from-gray-100 to-gray-50 dark:from-gray-800/60 dark:to-gray-800/30 px-4 py-3 border-r border-gray-300 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{quarter?.name || "Q2 2026"}</span>
                    <ScorePill tasks={all} size="lg" />
                  </div>
                </td>
                {categories.map((cat) => {
                  const ct = catTasks(cat);
                  const done = ct.filter((t) => t.status === "completed").length;
                  const catGoals = (goals || []).filter((g) => g.category === cat);
                  return (
                    <td key={cat} className="px-3 py-3 border-r border-gray-200/50 dark:border-gray-700/50 last:border-r-0 align-top">
                      {/* Q2 Goals */}
                      {catGoals.length > 0 && (
                        <div className="mb-2 space-y-1">
                          {catGoals.map((g) => (
                            <p key={g.id} className="text-[10px] text-gray-500 dark:text-gray-400 pl-2 border-l-2 border-indigo-300 dark:border-indigo-600 leading-tight">{g.goal}</p>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500">{ct.length} tasks</span>
                        {done > 0 && <span className="text-[10px] text-green-500">{done} done</span>}
                      </div>
                      {ct.length > 0 && (
                        <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
                          <div className="h-full bg-green-500 rounded-full transition-all duration-200" style={{ width: `${(done / ct.length) * 100}%` }} />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Iterations + weeks */}
              {iterations.map((iter) => {
                const isExpanded = expandedIters.has(iter.id);
                return (
                  <IterationRows key={iter.id} iter={iter} isExpanded={isExpanded}
                    onToggle={() => toggleIter(iter.id)} categories={categories}
                    allTasks={all} tasksFor={tasksFor} weekTasks={weekTasks} />
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function OwnerMap({ categories, tasks }: { categories: string[]; tasks: FullTask[] }) {
  // Build per-category owner breakdown. Only include categories actually in FIXED_CATEGORIES
  // so we stick to the six areas the reps care about.
  const cats = categories.filter((c) => FIXED_CATEGORIES.includes(c as typeof FIXED_CATEGORIES[number]));

  // Collect unique owners across all tasks (sorted by task count desc, primary names first)
  const ownerMap = new Map<string, { id: string; name: string }>();
  for (const t of tasks) {
    if (t.owner?.id && !ownerMap.has(t.owner.id)) {
      ownerMap.set(t.owner.id, { id: t.owner.id, name: t.owner.full_name });
    }
  }
  const owners = [...ownerMap.values()].sort((a, b) => {
    // Pin Leah + Chloe first so the map always reads Leah → Chloe when present
    const order = (n: string) => n === "Leah" ? 0 : n === "Chloe" ? 1 : 2;
    const o = order(a.name) - order(b.name);
    if (o !== 0) return o;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Who owns what across the six milestone areas this quarter. Tap any task to open it.
        </p>
        <div className="flex gap-3 flex-wrap text-[11px]">
          {owners.map((o) => {
            const style = OWNER_STYLE[o.name];
            return (
              <span key={o.id} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg ${style?.bg || "bg-gray-100 dark:bg-gray-800"}`}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: style?.dot || "#9CA3AF" }} />
                <span className={style?.text || "text-gray-600"}>{o.name}</span>
              </span>
            );
          })}
          {owners.length === 0 && <span className="text-gray-400">No owners assigned yet.</span>}
        </div>
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {cats.map((cat) => {
          const catTasks = tasks.filter((t) => t.category === cat);
          const displayName = CATEGORY_ALIAS[cat] || cat;
          return (
            <div key={cat} className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-200/60 dark:border-gray-800/60 flex items-center justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{displayName}</h3>
                  {displayName !== cat && <p className="text-[10px] text-gray-400 truncate">({cat})</p>}
                </div>
                <ScorePill tasks={catTasks} />
              </div>
              <div className="p-4 space-y-3">
                {owners.map((o) => {
                  const ownedHere = catTasks.filter((t) => t.owner_id === o.id);
                  const done = ownedHere.filter((t) => t.status === "completed").length;
                  const style = OWNER_STYLE[o.name];
                  return (
                    <div key={o.id} className={`rounded-xl border border-gray-200/50 dark:border-gray-800/40 ${style?.bg || "bg-gray-50/50 dark:bg-gray-800/20"}`}>
                      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200/40 dark:border-gray-800/30">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: style?.dot || "#9CA3AF" }} />
                          <span className={`text-xs font-semibold ${style?.text || "text-gray-700 dark:text-gray-300"}`}>{o.name}</span>
                        </div>
                        <span className="text-[10px] text-gray-500">
                          {ownedHere.length === 0 ? "No tasks" : `${done}/${ownedHere.length} done`}
                        </span>
                      </div>
                      {ownedHere.length > 0 ? (
                        <ul className="divide-y divide-gray-100 dark:divide-gray-800/40">
                          {ownedHere.map((t) => (
                            <li key={t.id} className="px-3 py-1.5 hover:bg-white/60 dark:hover:bg-gray-900/40 transition-colors">
                              <Link href={`/tasks/${t.id}`} className="flex items-start gap-2 min-w-0">
                                <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: STATUS_COLORS[t.status] }} />
                                <span className="text-[11px] leading-tight text-gray-700 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400">{t.title}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="px-3 py-2 text-[10px] text-gray-400 italic">Nothing assigned here.</p>
                      )}
                    </div>
                  );
                })}
                {owners.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">No owners for this area yet.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IterationRows({ iter, isExpanded, onToggle, categories, allTasks, tasksFor, weekTasks }: {
  iter: IterOption; isExpanded: boolean; onToggle: () => void; categories: string[];
  allTasks: FullTask[]; tasksFor: (iid: string, cat: string) => FullTask[]; weekTasks: (wid: string, cat: string) => FullTask[];
}) {
  return (
    <>
      <tr className="border-b border-gray-200/60 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-800/25 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-colors duration-200 cursor-pointer" onClick={onToggle}>
        <td className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-800/25 px-4 py-2.5 border-r border-gray-200/60 dark:border-gray-800/60">
          <div className="flex items-center gap-2">
            {isExpanded ? <HiChevronDown className="w-4 h-4 text-gray-400 transition-all duration-200" /> : <HiChevronRight className="w-4 h-4 text-gray-400 transition-all duration-200" />}
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{iter.name}</span>
            <ScorePill tasks={allTasks.filter((t) => t.iteration_id === iter.id)} />
          </div>
          <span className="text-[10px] text-gray-400 ml-7">{formatDate(iter.start_date)} — {formatDate(iter.end_date)}</span>
        </td>
        {categories.map((cat) => {
          const tasks = tasksFor(iter.id, cat);
          return (
            <td key={cat} className="px-3 py-2 border-r border-gray-100 dark:border-gray-800/40 last:border-r-0 align-top">
              {tasks.length > 0 ? (
                <div className="space-y-0.5">
                  {tasks.map((task) => <TaskChip key={task.id} task={task} />)}
                </div>
              ) : <span className="text-[10px] text-gray-300 dark:text-gray-700">—</span>}
            </td>
          );
        })}
      </tr>

      {isExpanded && (iter.weeks || []).map((week) => (
        <tr key={week.id} className="border-b border-gray-100 dark:border-gray-800/20 bg-white/80 dark:bg-gray-900/60 backdrop-blur-sm hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-colors duration-200">
          <td className="sticky left-0 z-10 bg-white/80 dark:bg-gray-900/60 backdrop-blur-sm pl-10 pr-4 py-2 border-r border-gray-200/60 dark:border-gray-800/60">
            <Link href={`/weeks/${week.id}`} className="block hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Week {week.week_number}</span>
                <ScorePill tasks={categories.flatMap((c) => weekTasks(week.id, c))} />
                <span className="text-[9px] text-blue-500">→</span>
              </div>
              <span className="text-[10px] text-gray-400">{formatDate(week.start_date)} — {formatDate(week.end_date)}</span>
            </Link>
          </td>
          {categories.map((cat) => {
            const wt = weekTasks(week.id, cat);
            return (
              <td key={cat} className="px-3 py-2 border-r border-gray-100 dark:border-gray-800/20 last:border-r-0 align-top">
                {wt.length > 0 ? (
                  <div className="space-y-0.5">{wt.map((t) => <TaskChip key={t.id} task={t} />)}</div>
                ) : <span className="text-[10px] text-gray-300 dark:text-gray-700">—</span>}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function TaskChip({ task }: { task: FullTask }) {
  const hasFb = (task.feedback?.length || 0) > 0;
  const hasDel = (task.deliverables?.length || 0) > 0;
  return (
    <div className="flex items-start gap-1.5 px-1.5 py-1 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-all duration-200">
      <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: STATUS_COLORS[task.status] }} />
      <Link href={`/tasks/${task.id}`} className="text-[11px] leading-tight text-gray-700 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
        {task.title}
      </Link>
      {hasFb && <HiOutlineChatAlt className="w-3 h-3 text-blue-400/60 flex-shrink-0" />}
      {hasDel && <HiOutlinePaperClip className="w-3 h-3 text-gray-400 flex-shrink-0" />}
    </div>
  );
}
