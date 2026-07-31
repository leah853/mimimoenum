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
import { FIXED_CATEGORIES, CATEGORY_GROUP, FOUNDATION_ORDER, FOUNDATION_LABEL, type FoundationGroup } from "@/lib/constants";
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
  type Saved = {
    quarter?: string; iter?: string; cat?: string; owners?: string[];
    urgency?: string; q?: string; view?: "board" | "list"; scope?: "me" | "team"; week?: string;
  };
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
  const initialView = (searchParams.get("view") as "board" | "list") || saved.view || "board";
  const initialScope = (saved.scope as "me" | "team") || "me";
  const initialWeekTab = saved.week || "";

  const [quarterId, setQuarterId] = useState<string>(initialQuarter);
  const [iterId, setIterId] = useState<string>(initialIter);
  const [catFilter, setCatFilter] = useState<string>(initialCat);
  const [ownerFilter, setOwnerFilter] = useState<string[]>(initialOwners);
  const [urgencyFilter, setUrgencyFilter] = useState<"all" | "overdue" | "due_today">(initialUrgency);
  const [search, setSearch] = useState<string>(initialSearch);
  const [showShippedByWeek, setShowShippedByWeek] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [creatingQuarter, setCreatingQuarter] = useState(false);
  const [view, setView] = useState<"board" | "list">(initialView);
  const [ownerScope, setOwnerScope] = useState<"me" | "team">(initialScope);
  const [activeWeekTab, setActiveWeekTab] = useState<string>(initialWeekTab); // "goals" | weekId
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const { dbUser } = useAuth();

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
        view, scope: ownerScope, week: activeWeekTab,
      }));
    } catch {}
  }, [quarterId, iterId, catFilter, ownerFilter, urgencyFilter, search, view, ownerScope, activeWeekTab]);

  // When the iteration changes, snap to the current week (or first) — the
  // week tab bar's "Now" tab must match reality.
  useEffect(() => {
    if (!iteration) return;
    const today = todayISO();
    const weeks = iteration.weeks || [];
    if (weeks.length === 0) { setActiveWeekTab("goals"); return; }
    const valid = new Set<string>(["goals", ...weeks.map((w) => w.id)]);
    if (activeWeekTab && valid.has(activeWeekTab)) return;
    const current = weeks.find((w) => w.start_date <= today && today <= w.end_date);
    setActiveWeekTab((current || weeks[0]).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iteration]);

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

  // Apply filters to build the visible task set. catFilter can be:
  //  "all"                     — no filter
  //  "__group__:apex"          — every category inside the apex foundation
  //  "<category name>"         — exact match
  const catGroupSelected: FoundationGroup | null = catFilter.startsWith("__group__:")
    ? (catFilter.slice("__group__:".length) as FoundationGroup)
    : null;
  const visible = useMemo(() => {
    const today = todayISO();
    const q = search.trim().toLowerCase();
    return all.filter((t) => {
      if (t.iteration_id !== iterId) return false;
      if (catFilter === "all") {
        // pass
      } else if (catGroupSelected) {
        if (!t.category || CATEGORY_GROUP[t.category] !== catGroupSelected) return false;
      } else if (t.category !== catFilter) {
        return false;
      }
      // Me scope narrows to the signed-in user's own tasks. Team scope respects
      // any explicit multi-owner filter chips.
      if (ownerScope === "me" && dbUser?.id) {
        if (t.owner_id !== dbUser.id) return false;
      } else if (ownerFilter.length > 0 && !ownerFilter.includes(t.owner_id || "__none__")) {
        return false;
      }
      if (urgencyFilter === "overdue" && !isTaskOverdue(t, today)) return false;
      if (urgencyFilter === "due_today" && !isTaskDueToday(t, today)) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, iterId, catFilter, catGroupSelected, ownerFilter, urgencyFilter, search, ownerScope, dbUser?.id]);

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

  // "Next quarter" name derived from the latest quarter's name so the button
  // label matches what will actually be created (Q2 2026 → Q3 2026 etc.).
  const latestQuarter = allQuarters[0];
  const suggestedNextName = (() => {
    if (!latestQuarter) return "next quarter";
    const m = latestQuarter.name.match(/^Q(\d)\s*(\d{4})$/i);
    if (!m) return "next quarter";
    const q = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    return q === 4 ? `Q1 ${y + 1}` : `Q${q + 1} ${y}`;
  })();
  const canAddNextQuarter = isDoer && quarterIdx === 0; // sitting on the newest already

  async function createNextQuarter() {
    if (!confirm(`Create ${suggestedNextName} — 4 iterations of 3 weeks each?`)) return;
    setCreatingQuarter(true);
    try {
      const res = await fetch("/api/quarters/next", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      toast(`Created ${j.quarter?.name || "quarter"} · ${j.iterations_created} iters · ${j.weeks_created} weeks`, "success");
      // Refetch quarters — useApi doesn't re-run without a nudge, so hit the
      // browser's cache-buster by adding a query param via location.reload().
      // Simpler: force a soft refresh of the quarters endpoint.
      window.location.reload();
    } catch (e) {
      toast(handleApiError(e), "error");
    } finally {
      setCreatingQuarter(false);
    }
  }

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
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Me / Team scope — hidden for reps (no dbUser owning tasks) */}
          {dbUser && (
            <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-full p-0.5">
              <button type="button" onClick={() => setOwnerScope("me")}
                className={`px-2.5 py-1 text-[11.5px] font-medium rounded-full transition-all ${ownerScope === "me" ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm" : "text-gray-600 dark:text-gray-400"}`}>
                Me
              </button>
              <button type="button" onClick={() => setOwnerScope("team")}
                className={`px-2.5 py-1 text-[11.5px] font-medium rounded-full transition-all ${ownerScope === "team" ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm" : "text-gray-600 dark:text-gray-400"}`}>
                Team
              </button>
            </div>
          )}
          {/* Board / List view */}
          <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-full p-0.5">
            <button type="button" onClick={() => setView("board")}
              className={`px-2.5 py-1 text-[11.5px] font-medium rounded-full transition-all ${view === "board" ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm" : "text-gray-600 dark:text-gray-400"}`}>
              Board
            </button>
            <button type="button" onClick={() => setView("list")}
              className={`px-2.5 py-1 text-[11.5px] font-medium rounded-full transition-all ${view === "list" ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm" : "text-gray-600 dark:text-gray-400"}`}>
              List
            </button>
          </div>
          {/* Quarter switcher — segmented pills showing every quarter,
              current one highlighted. Fixes "arrows don't say what's on
              the other side" confusion. */}
          <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            {[...allQuarters].reverse().map((q) => {
              const isActive = q.id === quarterId;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setQuarterId(q.id)}
                  title={`${q.name} · ${dateRange(q.start_date, q.end_date)}`}
                  className={`px-2.5 py-1 text-[11.5px] font-medium rounded-md transition-all ${
                    isActive
                      ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  }`}
                >
                  {q.name}
                </button>
              );
            })}
          </div>
          {canAddNextQuarter && (
            <button
              type="button"
              onClick={createNextQuarter}
              disabled={creatingQuarter}
              title={`Create ${suggestedNextName}: 4 iterations, 3 weeks each`}
              className="ml-1 inline-flex items-center gap-1 px-2.5 py-1.5 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-[11.5px] font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-solid transition-all disabled:opacity-50"
            >
              <HiPlus className="w-3.5 h-3.5" />
              {creatingQuarter ? "Creating…" : `Add ${suggestedNextName}`}
            </button>
          )}
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

      {/* ── BOARD view ────────────────────────────────────────────── */}
      {view === "board" && (
        <BoardLayout
          iteration={iteration}
          iterations={iterations}
          iterId={iterId}
          setIterId={setIterId}
          allTasks={all}
          visible={visible}
          all={all}
          iterCounts={iterCounts}
          activeWeekTab={activeWeekTab}
          setActiveWeekTab={setActiveWeekTab}
          onDrop={async (taskId, newStatus) => {
            if (newStatus === "completed") {
              const t = all.find((x) => x.id === taskId);
              if (t && !t.deliverables?.length) { toast("Cannot ship — no deliverable uploaded", "error"); return; }
              if (t && !t.feedback?.length) { toast("Cannot ship — no feedback received", "error"); return; }
            }
            setTasks((prev) => prev ? prev.map((t) => t.id === taskId ? { ...t, status: newStatus } as FullTask : t) : prev);
            try { await apiPatch(`/api/tasks/${taskId}`, { status: newStatus }); }
            catch (e) { toast(handleApiError(e), "error"); await refetch(); }
          }}
          draggingId={draggingId}
          setDraggingId={setDraggingId}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          catFilter={catFilter}
          setCatFilter={setCatFilter}
          urgencyFilter={urgencyFilter}
          setUrgencyFilter={setUrgencyFilter}
          search={search}
          setSearch={setSearch}
          categories={dynamicCats}
          catCounts={catCounts}
        />
      )}

      {/* ── LIST view (v3 focus feed) — everything below is unchanged  */}
      {view === "list" && (<>
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

      {/* ── Category chips — grouped by the 3 foundations ───────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <ChipButton active={catFilter === "all"} onClick={() => setCatFilter("all")} label="All" count={catCounts.get("__all__") || 0} />
        {FOUNDATION_ORDER.map((group, gi) => {
          const groupCats = dynamicCats.filter((c) => CATEGORY_GROUP[c] === group);
          if (groupCats.length === 0) return null;
          const groupTotal = groupCats.reduce((s, c) => s + (catCounts.get(c) || 0), 0);
          const groupActive = catFilter === `__group__:${group}`;
          const isApex = group === "apex";
          return (
            <div key={group} className="inline-flex items-center gap-1">
              {gi > 0 && <span className="w-px h-4 bg-gray-200 dark:bg-gray-800 mx-0.5" aria-hidden="true" />}
              <button
                type="button"
                onClick={() => setCatFilter(groupActive ? "all" : `__group__:${group}`)}
                title={`${FOUNDATION_LABEL[group]} — click to select the whole group`}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider transition-all ${
                  groupActive
                    ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                    : isApex
                      ? "bg-amber-50 dark:bg-amber-900/15 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/25"
                      : "bg-gray-100/60 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 hover:bg-gray-200/70 dark:hover:bg-gray-700/60"
                }`}
              >
                {isApex && <span>★</span>}
                {FOUNDATION_LABEL[group]}
                <span className={groupActive ? "opacity-60" : "opacity-70"}>{groupTotal}</span>
              </button>
              {groupCats.map((c) => (
                <ChipButton
                  key={c}
                  active={catFilter === c}
                  onClick={() => setCatFilter(c)}
                  label={c}
                  count={catCounts.get(c) || 0}
                />
              ))}
            </div>
          );
        })}
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
      </>)}

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

// ─── Board layout ──────────────────────────────────────────────────────────
// Health strip + filter chips + week tabs + kanban columns for the active week.
const BOARD_COLUMNS: { status: TaskStatus; label: string; dot: string }[] = [
  { status: "not_started", label: "To do", dot: "#B4B2A9" },
  { status: "in_progress", label: "In progress", dot: "#EF9F27" },
  { status: "under_review", label: "Review", dot: "#185FA5" },
  { status: "completed", label: "Shipped", dot: "#639922" },
];

function BoardLayout({
  iteration, iterations, iterId, setIterId, allTasks,
  visible, all, iterCounts, activeWeekTab, setActiveWeekTab,
  onDrop, draggingId, setDraggingId, dropTarget, setDropTarget,
  catFilter, setCatFilter, urgencyFilter, setUrgencyFilter,
  search, setSearch, categories, catCounts,
}: {
  iteration: IterOption;
  iterations: IterOption[];
  iterId: string;
  setIterId: (id: string) => void;
  allTasks: FullTask[];
  visible: FullTask[];
  all: FullTask[];
  iterCounts: { total: number; done: number; late: number; due: number };
  activeWeekTab: string;
  setActiveWeekTab: (s: string) => void;
  onDrop: (taskId: string, newStatus: TaskStatus) => Promise<void>;
  draggingId: string | null;
  setDraggingId: (s: string | null) => void;
  dropTarget: TaskStatus | null;
  setDropTarget: (s: TaskStatus | null) => void;
  catFilter: string;
  setCatFilter: (s: string) => void;
  urgencyFilter: "all" | "overdue" | "due_today";
  setUrgencyFilter: (v: "all" | "overdue" | "due_today") => void;
  search: string;
  setSearch: (s: string) => void;
  categories: string[];
  catCounts: Map<string, number>;
}) {
  void all;
  const [catOpen, setCatOpen] = useState(false);
  const weeks = (iteration.weeks || []).slice().sort((a, b) => a.week_number - b.week_number);
  const today = todayISO();

  // Counts per week (uses `visible` so tab counts reflect the current filters).
  const weekTabs: { key: string; label: string; sub: string; count: number; isCurrent: boolean; isPast: boolean; isFuture: boolean; shipped: number }[] = [];
  const goalsTasks = visible.filter((t) => !t.week_id);
  weekTabs.push({
    key: "goals", label: "Iter goals",
    sub: goalsTasks.length ? `${goalsTasks.length} · no week` : "no week",
    count: goalsTasks.length, isCurrent: false, isPast: false, isFuture: false, shipped: 0,
  });
  for (const w of weeks) {
    const wTasks = visible.filter((t) => t.week_id === w.id);
    const shipped = wTasks.filter((t) => t.status === "completed").length;
    const open = wTasks.length - shipped;
    const isPast = w.end_date < today;
    const isFuture = w.start_date > today;
    const isCurrent = !isPast && !isFuture;
    weekTabs.push({
      key: w.id,
      label: `Week ${w.week_number}`,
      sub: `${shortDate(w.start_date)} – ${shortDate(w.end_date)}${isPast ? ` · shipped ${shipped}` : isFuture ? ` · ${wTasks.length} planned` : ` · ${open} open`}`,
      count: wTasks.length,
      isCurrent, isPast, isFuture, shipped,
    });
  }

  // Tasks in the currently-selected week tab, further split by status.
  const inActiveTab = visible.filter((t) => activeWeekTab === "goals" ? !t.week_id : t.week_id === activeWeekTab);
  const byStatus: Record<TaskStatus, FullTask[]> = {
    not_started: [], in_progress: [], under_review: [], completed: [], blocked: [],
  };
  for (const t of inActiveTab) byStatus[t.status].push(t);
  // Sort within column: urgency-first, then deadline
  for (const s of Object.keys(byStatus) as TaskStatus[]) {
    byStatus[s].sort((a, b) => {
      const aLate = isTaskOverdue(a, today) ? 0 : isTaskDueToday(a, today) ? 1 : 2;
      const bLate = isTaskOverdue(b, today) ? 0 : isTaskDueToday(b, today) ? 1 : 2;
      if (aLate !== bLate) return aLate - bLate;
      return (a.deadline || "").localeCompare(b.deadline || "");
    });
  }

  const pct = iterCounts.total > 0 ? Math.round((iterCounts.done / iterCounts.total) * 100) : 0;

  return (
    <>
      {/* Iteration switcher — compact segmented row so users can jump
          across the quarter without leaving Board view. Each pill shows
          the iter name + a done/total or "shipped" summary. */}
      <div className="flex gap-1">
        {iterations.map((it) => {
          const scoped = allTasks.filter((t) => t.iteration_id === it.id);
          const done = scoped.filter((t) => t.status === "completed").length;
          const total = scoped.length;
          const isPast = it.end_date < today;
          const isFuture = it.start_date > today;
          const isCurrent = !isPast && !isFuture;
          const isActive = it.id === iterId;
          const late = scoped.filter((t) => isTaskOverdue(t, today)).length;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => setIterId(it.id)}
              className={`text-left rounded-lg px-3 py-1.5 transition-all flex-1 min-w-0 ${
                isActive
                  ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                  : isPast
                    ? "bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800/50"
                    : "bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/50"
              }`}
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

      {/* Health strip */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-900/50 rounded-lg text-[11.5px] text-gray-500 dark:text-gray-400 flex-wrap">
        <span className="font-medium text-gray-800 dark:text-gray-100">{pct}% shipped</span>
        {iterCounts.late > 0 && (
          <button type="button" onClick={() => setUrgencyFilter(urgencyFilter === "overdue" ? "all" : "overdue")}
            className={`px-1.5 py-0.5 rounded font-medium transition-all ${urgencyFilter === "overdue" ? "bg-red-500 text-white" : "text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20"}`}>
            {iterCounts.late} late
          </button>
        )}
        {iterCounts.due > 0 && (
          <button type="button" onClick={() => setUrgencyFilter(urgencyFilter === "due_today" ? "all" : "due_today")}
            className={`px-1.5 py-0.5 rounded font-medium transition-all ${urgencyFilter === "due_today" ? "bg-amber-500 text-white" : "text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/20"}`}>
            {iterCounts.due} due today
          </button>
        )}
        <span className="text-gray-500 dark:text-gray-400">· {visible.filter((t) => t.status === "under_review").length} in review</span>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <div className="inline-flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full px-2 py-0.5">
            <HiSearch className="w-3 h-3 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
              className="bg-transparent border-0 outline-none text-[11.5px] w-20 sm:w-32" />
          </div>
          {/* Category dropdown — grouped by foundation */}
          <div className="relative">
            <button type="button" onClick={() => setCatOpen(!catOpen)}
              className={`inline-flex items-center gap-1 border rounded-full px-2.5 py-0.5 text-[11.5px] transition-all ${catFilter === "all" ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" : "border-gray-900 dark:border-white bg-gray-900 dark:bg-white text-white dark:text-gray-900"}`}>
              {catFilter === "all"
                ? "All categories"
                : catFilter.startsWith("__group__:")
                  ? FOUNDATION_LABEL[catFilter.slice("__group__:".length) as FoundationGroup]
                  : catFilter}
              <span className="opacity-60">▾</span>
            </button>
            {catOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setCatOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-64 max-h-96 overflow-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
                  <button type="button" onClick={() => { setCatFilter("all"); setCatOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between ${catFilter === "all" ? "bg-gray-100 dark:bg-gray-800" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                    <span>All categories</span>
                    <span className="text-gray-500 text-[11px]">{catCounts.get("__all__") || 0}</span>
                  </button>
                  {FOUNDATION_ORDER.map((g) => {
                    const groupCats = categories.filter((c) => CATEGORY_GROUP[c] === g);
                    if (!groupCats.length) return null;
                    const groupCount = groupCats.reduce((s, c) => s + (catCounts.get(c) || 0), 0);
                    const isApex = g === "apex";
                    return (
                      <div key={g} className="border-t border-gray-100 dark:border-gray-800 mt-1 pt-1">
                        <button type="button" onClick={() => { setCatFilter(`__group__:${g}`); setCatOpen(false); }}
                          className={`w-full text-left px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-wider flex items-center justify-between ${
                            catFilter === `__group__:${g}` ? "bg-gray-100 dark:bg-gray-800" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                          } ${isApex ? "text-amber-700 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`}>
                          <span>{isApex ? "★ " : ""}{FOUNDATION_LABEL[g]}</span>
                          <span className="text-[10.5px] font-normal opacity-70">{groupCount}</span>
                        </button>
                        {groupCats.map((c) => (
                          <button key={c} type="button" onClick={() => { setCatFilter(c); setCatOpen(false); }}
                            className={`w-full text-left pl-6 pr-3 py-1 text-[12px] flex items-center justify-between ${catFilter === c ? "bg-gray-100 dark:bg-gray-800" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                            <span>{c}</span>
                            <span className="text-gray-500 text-[10.5px]">{catCounts.get(c) || 0}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {urgencyFilter !== "all" && (
            <button type="button" onClick={() => setUrgencyFilter("all")} className="text-[10.5px] text-gray-400 hover:text-gray-700">clear</button>
          )}
        </div>
      </div>

      {/* Week tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 overflow-x-auto -mx-1 px-1">
        {weekTabs.map((t) => {
          const isActive = activeWeekTab === t.key;
          return (
            <button key={t.key} type="button" onClick={() => setActiveWeekTab(t.key)}
              className={`flex-shrink-0 text-left px-3 py-2 rounded-t-md border-b-2 -mb-px transition-all ${
                isActive
                  ? "border-gray-900 dark:border-white"
                  : t.isPast
                    ? "border-transparent opacity-70 hover:opacity-100"
                    : "border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/40"
              }`}>
              <div className="flex items-center gap-1.5">
                <span className={`text-[12px] ${isActive ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-700 dark:text-gray-300"}`}>{t.label}</span>
                {t.isCurrent && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-white bg-blue-600 px-1 py-0.5 rounded">now</span>
                )}
              </div>
              <div className={`text-[10px] mt-0.5 ${isActive ? "text-gray-600 dark:text-gray-400" : "text-gray-400 dark:text-gray-500"}`}>{t.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {BOARD_COLUMNS.map((col) => {
          const cards = byStatus[col.status];
          const isTarget = dropTarget === col.status && draggingId != null;
          return (
            <div key={col.status}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(col.status); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setDropTarget(null); }}
              onDrop={async (e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                setDraggingId(null);
                setDropTarget(null);
                if (id) await onDrop(id, col.status);
              }}
              className={`bg-gray-50 dark:bg-gray-900/40 rounded-xl p-2 flex flex-col gap-1.5 min-h-[240px] transition-colors ${isTarget ? "ring-2 ring-indigo-400 ring-offset-1 ring-offset-white dark:ring-offset-gray-950" : ""}`}>
              <div className="flex items-center justify-between px-1 py-1">
                <div className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.dot }} />
                  <span className="text-[10.5px] font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">{col.label}</span>
                </div>
                <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 rounded-full">{cards.length}</span>
              </div>
              {cards.length === 0 && (
                <div className="text-[10.5px] text-gray-300 dark:text-gray-700 italic px-1 py-4 text-center">
                  {col.status === "completed" ? "no wins yet" : "drop tasks here"}
                </div>
              )}
              {cards.map((t) => (
                <BoardCard key={t.id} task={t} onDragStart={() => setDraggingId(t.id)} onDragEnd={() => { setDraggingId(null); setDropTarget(null); }} dragging={draggingId === t.id} />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

function BoardCard({ task, onDragStart, onDragEnd, dragging }: { task: FullTask; onDragStart: () => void; onDragEnd: () => void; dragging: boolean }) {
  const today = todayISO();
  const overdue = isTaskOverdue(task, today);
  const dueToday = isTaskDueToday(task, today);
  const completed = task.status === "completed";
  const owner = task.owner?.full_name || null;
  const ownerTint = ownerTintOf(owner);
  const daysLate = overdue && task.deadline
    ? Math.max(1, Math.floor((new Date(today).getTime() - new Date(task.deadline).getTime()) / 86400000))
    : 0;

  const delivCount = task.deliverables?.length || 0;
  const fbCount = task.feedback?.length || 0;
  const avgScore = task.feedback && task.feedback.length
    ? task.feedback.reduce((s, f) => s + (f.rating || 0), 0) / task.feedback.length
    : null;
  const category = task.category || "";
  const group = category ? CATEGORY_GROUP[category] : null;
  const catDot = group === "apex" ? "#EF9F27" : group === "platform" ? "#0F6E56" : group === "people" ? "#534AB7" : "#B4B2A9";

  const cardBg = overdue ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/30"
    : dueToday ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30"
    : "bg-white dark:bg-gray-900 border-gray-200/70 dark:border-gray-800/60";

  return (
    <Link href={`/tasks/${task.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`block border rounded-lg p-2 text-left cursor-grab active:cursor-grabbing hover:shadow-sm transition-all ${cardBg} ${completed ? "opacity-70" : ""} ${dragging ? "opacity-40" : ""}`}
    >
      {category && (
        <div className="flex items-center justify-between gap-1 mb-1">
          <div className="inline-flex items-center gap-1 min-w-0">
            <span className="w-1.5 h-1.5 rounded-sm flex-shrink-0" style={{ background: catDot }} />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">{category}</span>
          </div>
          {overdue && <span className="text-[8.5px] font-semibold text-white bg-red-500 rounded px-1 py-0.5 flex-shrink-0">{daysLate}d late</span>}
          {dueToday && !overdue && <span className="text-[8.5px] font-semibold text-white bg-amber-500 rounded px-1 py-0.5 flex-shrink-0">due today</span>}
          {completed && avgScore != null && (
            <span className="text-[9px] font-semibold rounded px-1 py-0.5 flex-shrink-0"
              style={{
                background: avgScore >= 9 ? "#EAF3DE" : avgScore >= 6 ? "#FAEEDA" : "#FCEBEB",
                color: avgScore >= 9 ? "#3B6D11" : avgScore >= 6 ? "#854F0B" : "#A32D2D",
              }}>
              {avgScore.toFixed(1)}
            </span>
          )}
        </div>
      )}
      <div className={`text-[12.5px] font-medium leading-tight text-gray-900 dark:text-white ${completed ? "line-through decoration-gray-400" : ""}`}>
        {task.title}
      </div>
      <div className="flex items-center justify-between gap-1.5 mt-1.5 text-[10px] text-gray-500 dark:text-gray-400">
        <span className={overdue ? "text-red-600 dark:text-red-400 font-medium" : dueToday ? "text-amber-700 dark:text-amber-400 font-medium" : ""}>
          {task.deadline ? shortDate(task.deadline) : "no date"}
        </span>
        <div className="flex items-center gap-1.5">
          {delivCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-blue-500"><HiOutlinePaperClip className="w-3 h-3" />{delivCount}</span>
          )}
          {fbCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-violet-500"><HiOutlineChatAlt className="w-3 h-3" />{fbCount}</span>
          )}
          {owner
            ? <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8.5px] font-medium" style={{ background: ownerTint.bg, color: ownerTint.fg }}>{owner[0]}</span>
            : <span className="w-4 h-4 rounded-full border border-dashed border-gray-400 flex items-center justify-center text-[7px] text-gray-400">?</span>}
        </div>
      </div>
    </Link>
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
