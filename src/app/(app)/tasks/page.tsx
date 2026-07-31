"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Task, TaskStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";
import { useApi, apiPost, apiPatch } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { canCreateTasks } from "@/lib/roles";
import { HiPlus, HiOutlineChatAlt, HiOutlinePaperClip, HiOutlineFilm, HiX, HiChevronLeft, HiChevronRight, HiSearch } from "react-icons/hi";
import { FIXED_CATEGORIES } from "@/lib/constants";
import { isTaskOverdue, isTaskDueToday } from "@/lib/utils";
import { Skeleton, SkeletonRows, useToast } from "@/components/ui";
import { handleApiError } from "@/lib/utils";

type FullTask = Task & {
  owner?: { id: string; full_name: string };
  subtasks?: { id: string }[];
  deliverables?: { id: string; file_url?: string; file_name?: string }[];
  feedback?: { id: string; rating: number; acknowledged?: boolean; comment?: string }[];
};
type UserOption = { id: string; full_name: string; email: string };
type WeekOption = { id: string; week_number: number; start_date: string; end_date: string };
type IterOption = { id: string; name: string; start_date: string; end_date: string; weeks?: WeekOption[] };
type QuarterOption = { id: string; name: string; start_date: string; end_date: string; iterations: IterOption[] };

// ─── Palette per owner (soft chip colours matched to the app's existing
//    OWNER_STYLE tints — keeps continuity with the rest of the pages). ───
const OWNER_TINT: Record<string, { bg: string; fg: string; dot: string }> = {
  Chloe: { bg: "#E7EFFA", fg: "#1F4E82", dot: "#1F4E82" },
  Leah: { bg: "#FAEEDA", fg: "#854F0B", dot: "#854F0B" },
  Nate: { bg: "#EAF3DE", fg: "#3B6D11", dot: "#3B6D11" },
  Rep: { bg: "#EEEDFE", fg: "#3C3489", dot: "#3C3489" },
};
function ownerTintOf(name?: string | null) {
  if (!name) return { bg: "#F1EFE8", fg: "#5F5E5A", dot: "#5F5E5A" };
  const key = Object.keys(OWNER_TINT).find((k) => name.startsWith(k));
  return key ? OWNER_TINT[key] : { bg: "#F1EFE8", fg: "#5F5E5A", dot: "#5F5E5A" };
}

const STATUS_PILL: Record<TaskStatus, { bg: string; fg: string; label: string }> = {
  not_started: { bg: "#F1EFE8", fg: "#5F5E5A", label: "Not started" },
  in_progress: { bg: "#FAEEDA", fg: "#854F0B", label: "In progress" },
  under_review: { bg: "#E7EFFA", fg: "#1F4E82", label: "Under review" },
  completed: { bg: "#EAF3DE", fg: "#3B6D11", label: "Shipped" },
  blocked: { bg: "#FCEBEB", fg: "#A32D2D", label: "Blocked" },
};

function shortDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function dateRange(a?: string | null, b?: string | null) {
  if (!a || !b) return "";
  return `${shortDate(a)} – ${shortDate(b)}`;
}
function todayISO() { return new Date().toISOString().split("T")[0]; }

export default function TasksPage() {
  return (
    <Suspense fallback={<TasksSkeleton />}>
      <TasksInner />
    </Suspense>
  );
}

function TasksSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between"><Skeleton className="h-9 w-72" /><Skeleton className="h-9 w-40 rounded-xl" /></div>
      <Skeleton className="h-16 rounded-2xl" />
      <div className="flex gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-20 rounded-full" />)}</div>
      <SkeletonRows count={6} />
    </div>
  );
}

function TasksInner() {
  const { toast } = useToast();
  const { appRole } = useAuth();
  const isDoer = canCreateTasks(appRole);
  const searchParams = useSearchParams();

  // Persistent view state — sessionStorage-backed for back-button friendliness.
  type Saved = { quarter?: string; iter?: string; cat?: string; owners?: string[]; urgency?: string; q?: string };
  const saved: Saved = (() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(sessionStorage.getItem("tasksV3") || "{}"); } catch { return {}; }
  })();

  const initialQuarter = searchParams.get("quarter") || saved.quarter || "";
  const initialIter = searchParams.get("iter") || saved.iter || "";
  const initialCat = searchParams.get("cat") || saved.cat || "all";
  const initialOwners = Array.isArray(saved.owners) ? saved.owners : [];
  const initialUrgency = (searchParams.get("urgency") as "all" | "overdue" | "due_today") || (saved.urgency as "all" | "overdue" | "due_today") || "all";
  const initialSearch = searchParams.get("q") || saved.q || "";

  const [quarterId, setQuarterId] = useState<string>(initialQuarter);
  const [iterId, setIterId] = useState<string>(initialIter);
  const [catFilter, setCatFilter] = useState<string>(initialCat);
  const [ownerFilter, setOwnerFilter] = useState<string[]>(initialOwners);
  const [urgencyFilter, setUrgencyFilter] = useState<"all" | "overdue" | "due_today">(initialUrgency);
  const [search, setSearch] = useState<string>(initialSearch);
  const [showShippedByWeek, setShowShippedByWeek] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  const { data: tasks, loading, refetch, setData: setTasks } = useApi<FullTask[]>("/api/tasks");
  const { data: quarters } = useApi<QuarterOption[]>("/api/quarters");
  const { data: users } = useApi<UserOption[]>("/api/users/owners");

  const all = tasks || [];
  const allQuarters = quarters || [];
  const allUsers = users || [];

  // Auto-pick a quarter + iteration once data lands. Quarter = current (today
  // is inside it) → else most recent. Iteration = current → else the last one
  // that has any activity → else the first.
  useEffect(() => {
    if (!allQuarters.length) return;
    const today = todayISO();
    if (!quarterId || !allQuarters.some((q) => q.id === quarterId)) {
      const current = allQuarters.find((q) => q.start_date <= today && today <= q.end_date);
      setQuarterId((current || allQuarters[0]).id);
    }
  }, [allQuarters, quarterId]);

  const quarter = allQuarters.find((q) => q.id === quarterId) || null;
  const iterations = quarter?.iterations || [];

  useEffect(() => {
    if (!iterations.length) return;
    const today = todayISO();
    if (!iterId || !iterations.some((i) => i.id === iterId)) {
      const current = iterations.find((i) => i.start_date <= today && today <= i.end_date);
      const active = current
        || [...iterations].reverse().find((i) => all.some((t) => t.iteration_id === i.id && t.status !== "completed"))
        || iterations[0];
      setIterId(active.id);
    }
  }, [iterations, iterId, all]);

  const iteration = iterations.find((i) => i.id === iterId) || null;

  // Persist selected filters.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem("tasksV3", JSON.stringify({
        quarter: quarterId, iter: iterId, cat: catFilter,
        owners: ownerFilter, urgency: urgencyFilter, q: search,
      }));
    } catch {}
  }, [quarterId, iterId, catFilter, ownerFilter, urgencyFilter, search]);

  // Categories available in the current iteration (falls back to the fixed
  // set so chips don't disappear on an empty iteration).
  const dynamicCats = useMemo(() => {
    const inIter = all.filter((t) => t.iteration_id === iterId).map((t) => t.category).filter(Boolean) as string[];
    return [...new Set([...FIXED_CATEGORIES, ...inIter])];
  }, [all, iterId]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    m.set("__all__", all.filter((t) => t.iteration_id === iterId).length);
    for (const t of all) {
      if (t.iteration_id !== iterId) continue;
      const c = t.category || "Uncategorized";
      m.set(c, (m.get(c) || 0) + 1);
    }
    return m;
  }, [all, iterId]);

  // Apply filters to build the visible task set.
  const visible = useMemo(() => {
    const today = todayISO();
    const q = search.trim().toLowerCase();
    return all.filter((t) => {
      if (t.iteration_id !== iterId) return false;
      if (catFilter !== "all" && t.category !== catFilter) return false;
      if (ownerFilter.length > 0 && !ownerFilter.includes(t.owner_id || "__none__")) return false;
      if (urgencyFilter === "overdue" && !isTaskOverdue(t, today)) return false;
      if (urgencyFilter === "due_today" && !isTaskDueToday(t, today)) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, iterId, catFilter, ownerFilter, urgencyFilter, search]);

  // Iteration-scoped headline counts, for iter tiles + utility strip.
  const iterCounts = useMemo(() => {
    const scoped = all.filter((t) => t.iteration_id === iterId);
    const today = todayISO();
    return {
      total: scoped.length,
      done: scoped.filter((t) => t.status === "completed").length,
      late: scoped.filter((t) => isTaskOverdue(t, today)).length,
      due: scoped.filter((t) => isTaskDueToday(t, today)).length,
    };
  }, [all, iterId]);

  // Bucket the visible tasks into groups: week rows + "no week" iteration goals.
  const grouped = useMemo(() => {
    const buckets: {
      key: string;
      kind: "iter_goals" | "week";
      label: string;
      subLabel: string;
      week?: WeekOption;
      status: "past" | "current" | "future" | "loose";
      tasks: FullTask[];
    }[] = [];
    const today = todayISO();

    const noWeek = visible.filter((t) => !t.week_id);
    if (noWeek.length) {
      buckets.push({
        key: "iter-goals",
        kind: "iter_goals",
        label: "Iteration goals",
        subLabel: "no specific week",
        status: "loose",
        tasks: noWeek,
      });
    }
    const weeks = (iteration?.weeks || []).slice().sort((a, b) => a.week_number - b.week_number);
    for (const w of weeks) {
      const inWeek = visible.filter((t) => t.week_id === w.id);
      // If no tasks after filtering, still show empty weeks — the user's mental model is week-by-week.
      const status: "past" | "current" | "future" =
        w.end_date < today ? "past" : w.start_date > today ? "future" : "current";
      buckets.push({
        key: `w-${w.id}`,
        kind: "week",
        label: `Week ${w.week_number}`,
        subLabel: dateRange(w.start_date, w.end_date),
        week: w,
        status,
        tasks: inWeek,
      });
    }
    return buckets;
  }, [visible, iteration]);

  async function updateField(taskId: string, field: string, value: string | null) {
    if (field === "status" && value === "completed") {
      const t = all.find((x) => x.id === taskId);
      if (t && !t.deliverables?.length) { toast("Cannot ship — no deliverable uploaded", "error"); return; }
      if (t && !t.feedback?.length) { toast("Cannot ship — no feedback received", "error"); return; }
    }
    setTasks((prev) => prev ? prev.map((t) => t.id === taskId ? { ...t, [field]: value } as FullTask : t) : prev);
    try { await apiPatch(`/api/tasks/${taskId}`, { [field]: value }); }
    catch (e) { toast(handleApiError(e), "error"); await refetch(); }
  }

  if (loading || !iteration) {
    return <TasksSkeleton />;
  }

  const quarterIdx = allQuarters.findIndex((q) => q.id === quarterId);
  const prevQuarter = quarterIdx < allQuarters.length - 1 ? allQuarters[quarterIdx + 1] : null;
  const nextQuarter = quarterIdx > 0 ? allQuarters[quarterIdx - 1] : null;

  return (
    <div className="p-6 space-y-3 animate-fade-in">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {quarter?.name || "Quarter"} · {dateRange(quarter?.start_date, quarter?.end_date)}
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white mt-0.5">
            {iteration.name}
            <span className="ml-2 text-gray-500 dark:text-gray-400 font-normal">· {dateRange(iteration.start_date, iteration.end_date)}</span>
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => prevQuarter && setQuarterId(prevQuarter.id)}
            disabled={!prevQuarter}
            aria-label="Previous quarter"
            className="w-8 h-8 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <HiChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => nextQuarter && setQuarterId(nextQuarter.id)}
            disabled={!nextQuarter}
            aria-label="Next quarter"
            className="w-8 h-8 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <HiChevronRight className="w-4 h-4" />
          </button>
          {isDoer && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="ml-1 inline-flex items-center gap-1 px-3 py-1.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-700 dark:hover:bg-gray-200 transition-all"
            >
              <HiPlus className="w-4 h-4" /> New
            </button>
          )}
        </div>
      </div>

      {/* ── Iteration tiles ──────────────────────────────────────────── */}
      <div className="flex gap-1">
        {iterations.map((it) => {
          const scoped = all.filter((t) => t.iteration_id === it.id);
          const done = scoped.filter((t) => t.status === "completed").length;
          const total = scoped.length;
          const today = todayISO();
          const isPast = it.end_date < today;
          const isFuture = it.start_date > today;
          const isCurrent = !isPast && !isFuture;
          const isActive = it.id === iterId;
          const late = scoped.filter((t) => isTaskOverdue(t, today)).length;

          const baseCls = "text-left rounded-lg px-3 py-2 transition-all flex-1 min-w-0";
          const style = isActive
            ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
            : isPast
              ? "bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800/50"
              : isFuture
                ? "bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50"
                : "bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50";

          return (
            <button
              key={it.id}
              type="button"
              onClick={() => setIterId(it.id)}
              className={`${baseCls} ${style} ${isActive ? "flex-[1.4]" : ""}`}
            >
              <div className="text-[11.5px] font-semibold truncate">
                {it.name}
                {isCurrent && <span className={`ml-1 ${isActive ? "opacity-70" : "text-gray-400"}`}>· now</span>}
              </div>
              <div className={`text-[9.5px] mt-0.5 truncate ${isActive ? "opacity-70" : "text-gray-400"}`}>
                {shortDate(it.start_date)} · {isPast
                  ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">shipped {done}</span>
                  : isFuture
                    ? <span>planned {total}</span>
                    : <span>{done}/{total}{late > 0 ? <span className="text-amber-600 dark:text-amber-400 font-medium"> · {late} late</span> : ""}</span>
                }
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Category chips ───────────────────────────────────────────── */}
      <div className="flex gap-1.5 flex-wrap">
        <ChipButton active={catFilter === "all"} onClick={() => setCatFilter("all")} label="All" count={catCounts.get("__all__") || 0} />
        {dynamicCats.map((c) => (
          <ChipButton
            key={c}
            active={catFilter === c}
            onClick={() => setCatFilter(c)}
            label={c}
            count={catCounts.get(c) || 0}
          />
        ))}
      </div>

      {/* ── Utility strip ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-900/50 rounded-lg text-xs flex-wrap">
        <div className="flex items-center gap-1.5 flex-1 min-w-[140px] max-w-[240px]">
          <HiSearch className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="bg-transparent border-0 outline-none text-xs w-full text-gray-800 dark:text-gray-200"
          />
        </div>
        <span className="text-gray-500 dark:text-gray-400">Owner</span>
        <div className="flex items-center gap-1">
          {allUsers.map((u) => {
            const active = ownerFilter.includes(u.id);
            const tint = ownerTintOf(u.full_name);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setOwnerFilter((prev) => prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id])}
                title={active ? `${u.full_name} — click to remove` : `Filter to ${u.full_name}`}
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium transition-all ${active ? "" : "opacity-50 hover:opacity-100"}`}
                style={{
                  background: tint.bg,
                  color: tint.fg,
                  boxShadow: active ? `0 0 0 1.5px ${tint.dot}` : "none",
                }}
              >
                {u.full_name[0]}
              </button>
            );
          })}
          {ownerFilter.length > 0 && (
            <button
              type="button"
              onClick={() => setOwnerFilter([])}
              className="text-[10px] text-gray-400 hover:text-gray-600 ml-1"
            >
              clear
            </button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span>{visible.length} shown</span>
          {iterCounts.late > 0 && (
            <button
              type="button"
              onClick={() => setUrgencyFilter(urgencyFilter === "overdue" ? "all" : "overdue")}
              className={`px-2 py-0.5 rounded-md font-medium transition-all ${urgencyFilter === "overdue" ? "bg-red-500 text-white" : "text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20"}`}
            >
              {iterCounts.late} late
            </button>
          )}
          {iterCounts.due > 0 && (
            <button
              type="button"
              onClick={() => setUrgencyFilter(urgencyFilter === "due_today" ? "all" : "due_today")}
              className={`px-2 py-0.5 rounded-md font-medium transition-all ${urgencyFilter === "due_today" ? "bg-amber-500 text-white" : "text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/20"}`}
            >
              {iterCounts.due} due today
            </button>
          )}
          {urgencyFilter !== "all" && (
            <button
              type="button"
              onClick={() => setUrgencyFilter("all")}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >
              clear
            </button>
          )}
        </div>
      </div>

      {/* ── Week-grouped feed ───────────────────────────────────────── */}
      <div className="space-y-4">
        {grouped.map((g) => {
          if (g.tasks.length === 0 && g.kind === "iter_goals") return null;
          const showShipped = showShippedByWeek.has(g.key);
          const shipped = g.tasks.filter((t) => t.status === "completed");
          const activeTasks = g.tasks.filter((t) => t.status !== "completed");
          // Sort urgency first, then by deadline
          const sortedActive = activeTasks.slice().sort((a, b) => {
            const today = todayISO();
            const aLate = isTaskOverdue(a, today) ? 0 : isTaskDueToday(a, today) ? 1 : 2;
            const bLate = isTaskOverdue(b, today) ? 0 : isTaskDueToday(b, today) ? 1 : 2;
            if (aLate !== bLate) return aLate - bLate;
            return (a.deadline || "").localeCompare(b.deadline || "");
          });
          const rendered = showShipped ? [...sortedActive, ...shipped] : sortedActive;
          return (
            <div key={g.key}>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className={`text-xs font-semibold ${g.status === "current" ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>
                  {g.label}
                </span>
                <span className={`text-[10.5px] ${g.status === "current" ? "text-gray-500 dark:text-gray-400" : "text-gray-400 dark:text-gray-500"}`}>
                  {g.subLabel}
                </span>
                {g.status === "current" && g.kind === "week" && (
                  <span className="text-[9.5px] font-semibold text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">this week</span>
                )}
                {shipped.length > 0 && (
                  <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400">shipped {shipped.length}</span>
                )}
                <span className="flex-1 h-px bg-gray-200 dark:bg-gray-800 ml-1" />
                {shipped.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowShippedByWeek((prev) => {
                      const n = new Set(prev);
                      n.has(g.key) ? n.delete(g.key) : n.add(g.key);
                      return n;
                    })}
                    className="text-[10.5px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white"
                  >
                    {showShipped ? "hide shipped" : "show shipped"}
                  </button>
                )}
              </div>
              {rendered.length === 0 && (
                <div className="text-[11px] text-gray-400 dark:text-gray-600 italic pl-1">
                  {g.status === "future" ? "Nothing planned yet." : "Nothing here — enjoy the moment."}
                </div>
              )}
              <div className={`flex flex-col gap-1 ${g.status === "future" ? "opacity-90" : ""}`}>
                {rendered.map((t) => (
                  <TaskCard key={t.id} task={t} onStatusChange={(v) => updateField(t.id, "status", v)} isDoer={isDoer} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <CreateTaskModal
          users={allUsers}
          quarters={allQuarters}
          categories={dynamicCats}
          defaultIterationId={iterId}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refetch(); }}
        />
      )}
    </div>
  );
}

function ChipButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
        active
          ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
          : "bg-white dark:bg-gray-900/40 text-gray-700 dark:text-gray-300 border border-gray-200/70 dark:border-gray-700/70 hover:bg-gray-100 dark:hover:bg-gray-800/60"
      }`}
    >
      {label}
      <span className={active ? "opacity-60" : "text-gray-400 dark:text-gray-500"}>{count}</span>
    </button>
  );
}

function TaskCard({ task, onStatusChange, isDoer }: { task: FullTask; onStatusChange: (status: TaskStatus) => void; isDoer: boolean }) {
  const today = todayISO();
  const overdue = isTaskOverdue(task, today);
  const dueToday = isTaskDueToday(task, today);
  const completed = task.status === "completed";
  const owner = task.owner?.full_name || null;
  const ownerTint = ownerTintOf(owner);
  const statusMeta = STATUS_PILL[task.status];
  const daysLate = overdue && task.deadline
    ? Math.max(1, Math.floor((new Date(today).getTime() - new Date(task.deadline).getTime()) / 86400000))
    : 0;

  const cardBg = completed
    ? "bg-white dark:bg-gray-900/40"
    : overdue
      ? "bg-red-50/70 dark:bg-red-900/10"
      : dueToday
        ? "bg-amber-50/70 dark:bg-amber-900/10"
        : "bg-white dark:bg-gray-900/40";
  const cardBorder = overdue
    ? "border-red-200 dark:border-red-900/30"
    : dueToday
      ? "border-amber-200 dark:border-amber-900/30"
      : "border-gray-200/70 dark:border-gray-800/60";

  const delivCount = task.deliverables?.length || 0;
  const hasVideo = (task.deliverables || []).some((d) => (d.file_url || d.file_name || "").match(/\.(mp4|mov|webm|m4v|avi|mkv)$/i));
  const fbCount = task.feedback?.length || 0;
  const subCount = task.subtasks?.length || 0;
  const avgScore = task.feedback && task.feedback.length
    ? task.feedback.reduce((s, f) => s + (f.rating || 0), 0) / task.feedback.length
    : null;

  return (
    <Link
      href={`/tasks/${task.id}`}
      className={`block border rounded-xl px-3 py-2.5 transition-all hover:shadow-sm ${cardBg} ${cardBorder} ${completed ? "opacity-70" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[13.5px] font-medium text-gray-900 dark:text-white ${completed ? "line-through decoration-gray-400" : ""}`}>
              {task.title}
            </span>
            {overdue && (
              <span className="text-[9px] font-semibold text-white bg-red-500 rounded px-1.5 py-0.5">
                {daysLate === 1 ? "1 day late" : `${daysLate} days late`}
              </span>
            )}
            {dueToday && !overdue && (
              <span className="text-[9px] font-semibold text-white bg-amber-500 rounded px-1.5 py-0.5">due today</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[10.5px] text-gray-500 dark:text-gray-400">
            {task.category && <span>{task.category}</span>}
            {task.category && <span className="text-gray-300 dark:text-gray-700">·</span>}
            <span className="inline-flex items-center gap-1">
              {owner
                ? <>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: ownerTint.dot }} /> {owner}
                  </>
                : <>
                    <span className="w-1.5 h-1.5 rounded-full border border-dashed border-gray-400" /> unassigned
                  </>
              }
            </span>
            {task.deadline && (
              <>
                <span className="text-gray-300 dark:text-gray-700">·</span>
                <span className={overdue ? "text-red-600 dark:text-red-400" : dueToday ? "text-amber-700 dark:text-amber-400" : ""}>
                  {shortDate(task.deadline)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {subCount > 0 && (
            <span title={`${subCount} subtask${subCount === 1 ? "" : "s"}`} className="text-[10.5px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-0.5">
              <span className="opacity-70">⋮</span>{subCount}
            </span>
          )}
          {delivCount > 0 && (
            <span title={`${delivCount} deliverable${delivCount === 1 ? "" : "s"}`} className="text-[10.5px] text-blue-500 inline-flex items-center gap-0.5">
              <HiOutlinePaperClip className="w-3 h-3" />{delivCount}
            </span>
          )}
          {hasVideo && <HiOutlineFilm className="w-3 h-3 text-purple-500" />}
          {fbCount > 0 && (
            <span title={`${fbCount} feedback message${fbCount === 1 ? "" : "s"}`} className="text-[10.5px] text-violet-500 inline-flex items-center gap-0.5">
              <HiOutlineChatAlt className="w-3 h-3" />{fbCount}
            </span>
          )}
          {completed && avgScore != null && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{
                background: avgScore >= 9 ? "#EAF3DE" : avgScore >= 6 ? "#FAEEDA" : "#FCEBEB",
                color: avgScore >= 9 ? "#3B6D11" : avgScore >= 6 ? "#854F0B" : "#A32D2D",
              }}
            >
              {avgScore.toFixed(1)}/10
            </span>
          )}
          {isDoer ? (
            <select
              value={task.status}
              onClick={(e) => e.preventDefault() /* Link swallow — allow the select */}
              onChange={(e) => { e.preventDefault(); onStatusChange(e.target.value as TaskStatus); }}
              className="text-[10.5px] font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer appearance-none"
              style={{ background: statusMeta.bg, color: statusMeta.fg }}
            >
              {(Object.entries(STATUS_LABELS) as [TaskStatus, string][]).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          ) : (
            <span
              className="text-[10.5px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: statusMeta.bg, color: statusMeta.fg }}
            >
              {statusMeta.label}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function CreateTaskModal({ users, quarters, categories, defaultIterationId, onClose, onCreated }: {
  users: UserOption[]; quarters: QuarterOption[]; categories: string[]; defaultIterationId?: string; onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(categories[0] || "");
  const [newCat, setNewCat] = useState("");
  const [ownerId, setOwnerId] = useState(users[0]?.id || "");
  const [deadline, setDeadline] = useState("");
  const [iterationId, setIterationId] = useState(defaultIterationId || "");
  const [quarterIdLocal, setQuarterIdLocal] = useState(quarters[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const currentQuarter = quarters.find((q) => q.id === quarterIdLocal) || quarters[0];
  const iterations = currentQuarter?.iterations || [];
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalNode(document.body);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => titleInputRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  async function handleCreate() {
    if (!title || !ownerId || !deadline) { setError("Title, owner, and deadline are required"); return; }
    setSaving(true); setError("");
    try {
      await apiPost("/api/tasks", {
        title, description: description || null, category: newCat || category || null,
        owner_id: ownerId, deadline, quarter_id: quarterIdLocal || null,
        iteration_id: iterationId || null, status: "not_started",
      });
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    setSaving(false);
  }

  if (!portalNode) return null;

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ zIndex: 9999 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/60 dark:border-gray-700/60 rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
        >
          <HiX className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white pr-8">Create task</h2>
        {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>}
        <div><label className="text-xs text-gray-500 mb-1 block">Title *</label>
          <input ref={titleInputRef} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all" /></div>
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
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-xs text-gray-500 mb-1 block">Deadline *</label>
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all" /></div>
          <div><label className="text-xs text-gray-500 mb-1 block">Quarter</label>
            <select value={quarterIdLocal} onChange={(e) => { setQuarterIdLocal(e.target.value); setIterationId(""); }}
              className="w-full px-3 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all">
              {quarters.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-500 mb-1 block">Iteration</label>
            <select value={iterationId} onChange={(e) => setIterationId(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all">
              <option value="">None</option>
              {iterations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select></div>
        </div>
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all">Cancel</button>
          <button onClick={handleCreate} disabled={saving || !title || !ownerId || !deadline}
            className="px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:brightness-110 disabled:opacity-50 text-sm rounded-xl shadow-md transition-all active:scale-[0.97]">
            {saving ? "Creating..." : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, portalNode);
}
