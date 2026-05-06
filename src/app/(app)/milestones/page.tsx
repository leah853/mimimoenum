"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useApi } from "@/lib/use-api";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import type { Task, TaskStatus } from "@/lib/types";
import { HiChevronDown, HiChevronRight, HiOutlineChatAlt, HiOutlinePaperClip, HiPlus } from "react-icons/hi";
import { SkeletonRows, EmptyState } from "@/components/ui";

type FullTask = Task & { subtasks?: { id: string; title: string; status: TaskStatus }[]; deliverables?: { id: string }[]; feedback?: { id: string }[]; owner?: { id: string; full_name: string } };
type WeekOption = { id: string; week_number: number; start_date: string; end_date: string };
type IterOption = { id: string; name: string; start_date: string; end_date: string; weeks?: WeekOption[] };
type QuarterOption = { id: string; name: string; start_date: string; end_date: string; iterations: IterOption[] };

import {
  FIXED_CATEGORIES,
  OWNER_STYLE,
  CATEGORY_ALIAS,
  CATEGORY_GROUP,
  FOUNDATION_ORDER,
  FOUNDATION_LABEL,
  FOUNDATION_TAGLINE,
  type FoundationGroup,
  type CategoryName,
} from "@/lib/constants";
import { calcScore, formatDate } from "@/lib/utils";

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
  const [activeTab, setActiveTab] = useState<"timeline" | "owner_map">("timeline");

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

      {/* Tabs: Timeline / Owner Map */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        <button onClick={() => setActiveTab("timeline")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${activeTab === "timeline" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          Timeline
        </button>
        <button onClick={() => setActiveTab("owner_map")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${activeTab === "owner_map" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          Owner Map
        </button>
      </div>

      {activeTab === "owner_map" && <OwnerMap categories={categories} tasks={all} iterations={iterations} />}

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

// Extract a short "theme" from a task title so we can group similar tasks into
// one readable bullet instead of dumping every title as its own line.
// Heuristic: take the chunk before a colon/parenthesis, strip common prefixes,
// then normalize. Tasks that share the same theme key get clustered.
function themeOf(title: string): { key: string; label: string } {
  const trimmed = title.trim();
  // Take text before first colon or open paren — usually the core subject
  const head = trimmed.split(/[:(\-–—]/)[0].trim();
  // Strip common action prefixes so "Analyse Data" and "Data Analysis" collapse
  const cleaned = head
    .replace(/^(setup|build|create|launch|draft|design|review|plan|analyse|analyze|prepare|develop|define|start|begin|finalize|finalise|ship|publish|document|write)\s+/i, "")
    .replace(/\s+(setup|plan|draft|review)$/i, "")
    .replace(/[.,;]+$/g, "")
    .trim();
  const core = cleaned || head || trimmed;
  return { key: core.toLowerCase(), label: core };
}

// Group tasks into thought-through themes; return sorted clusters.
function clusterTasks(tasks: FullTask[]) {
  const buckets = new Map<string, { label: string; tasks: FullTask[] }>();
  for (const t of tasks) {
    const { key, label } = themeOf(t.title);
    if (!buckets.has(key)) buckets.set(key, { label, tasks: [] });
    buckets.get(key)!.tasks.push(t);
  }
  // Sort clusters: larger groups first, then singletons alphabetically
  return [...buckets.values()].sort((a, b) => {
    const sizeDiff = b.tasks.length - a.tasks.length;
    if (sizeDiff !== 0) return sizeDiff;
    return a.label.localeCompare(b.label);
  });
}

// Short summary headline per area based on the biggest theme.
function areaHeadline(ownerName: string, clusters: ReturnType<typeof clusterTasks>, total: number, done: number): string {
  if (total === 0) return `No work assigned to ${ownerName} yet in this area.`;
  const top = clusters[0];
  const donePct = total > 0 ? Math.round((done / total) * 100) : 0;
  if (clusters.length === 1) {
    return `${ownerName} is driving ${top.label.toLowerCase()} — ${done}/${total} done (${donePct}%).`;
  }
  const themes = clusters.slice(0, 3).map((c) => c.label.toLowerCase());
  const themeText = themes.length === 2 ? `${themes[0]} and ${themes[1]}` : `${themes.slice(0, -1).join(", ")}, and ${themes[themes.length - 1]}`;
  return `${ownerName} owns ${themeText} — ${done}/${total} done (${donePct}%).`;
}

// Tokenize a title for similarity scoring.
const STOPWORDS = new Set(["a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "with", "by", "at", "from", "as", "is", "are", "be", "was", "were"]);
function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Jaccard similarity over meaningful tokens — 0 (nothing in common) to 1 (identical bag of words).
function titleSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return union > 0 ? shared / union : 0;
}

// Pick the iteration goal that best matches a given week task title.
// Ties go to the first goal (stable with `goals` array order).
function pickBestGoal(weekTaskTitle: string, goals: FullTask[]): FullTask {
  let best = goals[0];
  let bestScore = -1;
  for (const g of goals) {
    const score = titleSimilarity(weekTaskTitle, g.title);
    if (score > bestScore) { best = g; bestScore = score; }
  }
  return best;
}

// Build an iteration-first hierarchy for one owner's tasks in one category.
// Every week task MUST nest under an iteration goal (no invented goals). If no
// goals exist at all for an iteration+owner+category, surface a warning bullet
// so the gap is visible instead of silently hidden.
type IterBullet = { label: string; goalTask: FullTask | null; childTasks: FullTask[] };
type IterBlock = { iterationId: string | null; iterationName: string; bullets: IterBullet[]; totalTasks: number; doneTasks: number };

function buildIterationHierarchy(tasks: FullTask[], iterations: IterOption[]): IterBlock[] {
  const byIter = new Map<string, FullTask[]>();
  for (const t of tasks) {
    const key = t.iteration_id || "__none__";
    if (!byIter.has(key)) byIter.set(key, []);
    byIter.get(key)!.push(t);
  }

  const blocks: IterBlock[] = [];
  const orderedKeys = [...iterations.map((i) => i.id), ...[...byIter.keys()].filter((k) => k === "__none__" || !iterations.some((i) => i.id === k))];
  const seen = new Set<string>();
  for (const key of orderedKeys) {
    if (seen.has(key) || !byIter.has(key)) continue;
    seen.add(key);
    const iterTasks = byIter.get(key)!;
    const iterName = key === "__none__" ? "Unassigned iteration" : (iterations.find((i) => i.id === key)?.name || "Iteration");

    const goalTasks = iterTasks.filter((t) => !t.week_id);
    const weekTasks = iterTasks.filter((t) => t.week_id);

    const bullets: IterBullet[] = [];

    if (goalTasks.length === 0) {
      // No iteration goals for this owner+category+iteration — we don't
      // invent a parent. Week tasks in this situation are intentionally not
      // rendered here (see chat: user prefers to map them manually once the
      // goal is defined). The iteration header for this block is skipped
      // below when bullets is empty.
    } else {
      // Each iteration goal becomes a bullet. Every week task gets assigned to
      // the best-matching goal via Jaccard similarity over title tokens; if no
      // tokens overlap, the first goal is used as the deterministic fallback.
      const goalBucket = new Map<string, FullTask[]>();
      for (const g of goalTasks) goalBucket.set(g.id, []);

      for (const w of weekTasks) {
        const best = pickBestGoal(w.title, goalTasks);
        goalBucket.get(best.id)!.push(w);
      }

      for (const g of goalTasks) {
        bullets.push({ label: g.title, goalTask: g, childTasks: goalBucket.get(g.id) || [] });
      }
    }

    const totalTasks = iterTasks.length;
    const doneTasks = iterTasks.filter((t) => t.status === "completed").length;
    blocks.push({ iterationId: key === "__none__" ? null : key, iterationName: iterName, bullets, totalTasks, doneTasks });
  }

  return blocks;
}

// Emoji per area for a bit of visual interest.
const AREA_EMOJI: Record<string, string> = {
  "Milestone Execution":          "🎯",
  "Workflows":                    "🔁",
  "Product & Engineering":        "⚙️",
  "Cybersecurity / Compliance":   "🛡️",
  "Talent Acquisition":           "👥",
  "Training & Culture":           "📚",
  "Branding":                     "🎨",
};

// Group accent classes (apex gets a distinct gold/indigo treatment).
const FOUNDATION_ACCENT: Record<FoundationGroup, { wrap: string; pill: string; pillText: string }> = {
  apex:     { wrap: "border-amber-300/70 dark:border-amber-700/40 bg-gradient-to-br from-amber-50/80 to-indigo-50/60 dark:from-amber-900/15 dark:to-indigo-900/10",
              pill: "bg-gradient-to-r from-amber-100 to-indigo-100 dark:from-amber-900/30 dark:to-indigo-900/20",
              pillText: "text-amber-700 dark:text-amber-300" },
  platform: { wrap: "border-blue-200/60 dark:border-blue-800/30",
              pill: "bg-blue-50 dark:bg-blue-900/15",
              pillText: "text-blue-700 dark:text-blue-300" },
  people:   { wrap: "border-emerald-200/60 dark:border-emerald-800/30",
              pill: "bg-emerald-50 dark:bg-emerald-900/15",
              pillText: "text-emerald-700 dark:text-emerald-300" },
};

// The two canonical owners; anything else is treated as "yet to be defined".
const CANONICAL_OWNERS = ["Leah", "Chloe"] as const;

function OwnerMap({ categories, tasks, iterations }: { categories: string[]; tasks: FullTask[]; iterations: IterOption[] }) {
  const cats = categories.filter((c) => FIXED_CATEGORIES.includes(c as typeof FIXED_CATEGORIES[number]));

  // Pull the two canonical owners' DB rows from the tasks we already have,
  // so we can render even if one of them hasn't been assigned yet.
  const ownerLookup = new Map<string, { id: string; name: string }>();
  for (const t of tasks) {
    if (t.owner?.full_name && CANONICAL_OWNERS.includes(t.owner.full_name as typeof CANONICAL_OWNERS[number])) {
      ownerLookup.set(t.owner.full_name, { id: t.owner.id!, name: t.owner.full_name });
    }
  }
  const owners = CANONICAL_OWNERS.map((name) => ownerLookup.get(name) || { id: name, name });

  // Identify tasks owned by someone other than the two canonical owners
  const undefinedOwnerTasks = tasks.filter((t) => {
    if (!t.owner?.full_name) return true;
    return !CANONICAL_OWNERS.includes(t.owner.full_name as typeof CANONICAL_OWNERS[number]);
  });

  return (
    <div className="space-y-5">
      {/* Header callout */}
      <div className="bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/15 dark:to-violet-900/10 border border-indigo-200/60 dark:border-indigo-800/30 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">🗺️</span>
          <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Ownership Map</h3>
        </div>
        <p className="text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed">
          Two active owners this quarter: <span className="font-semibold" style={{ color: OWNER_STYLE.Leah?.dot }}>Leah</span> and <span className="font-semibold" style={{ color: OWNER_STYLE.Chloe?.dot }}>Chloe</span>. All other roles across the six areas are <span className="italic text-gray-500">yet to be defined</span>.
        </p>
        {undefinedOwnerTasks.length > 0 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
            {undefinedOwnerTasks.length} task{undefinedOwnerTasks.length === 1 ? "" : "s"} currently assigned outside Leah / Chloe — review and reassign.
          </p>
        )}
      </div>

      {/* Foundation-grouped area cards: Apex (Milestone Execution) on top, then Platform / People / Branding */}
      {FOUNDATION_ORDER.map((group) => {
        const groupCats = cats.filter((c) => CATEGORY_GROUP[c] === group);
        if (groupCats.length === 0) return null;
        const accent = FOUNDATION_ACCENT[group];
        const isApex = group === "apex";
        return (
          <section key={group} className="space-y-2">
            {/* Group header pill */}
            <div className={`flex items-center gap-3 px-3 py-1.5 rounded-xl border ${accent.pill} ${isApex ? "border-amber-300/60 dark:border-amber-700/40" : "border-transparent"}`}>
              <span className={`text-[11px] font-bold uppercase tracking-[0.08em] ${accent.pillText}`}>
                {isApex ? "★ Apex — " : ""}{FOUNDATION_LABEL[group]}
              </span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{FOUNDATION_TAGLINE[group]}</span>
            </div>

            <div className={isApex ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 lg:grid-cols-2 gap-4"}>
              {groupCats.map((cat) => {
          const catTasks = tasks.filter((t) => t.category === cat);
          const displayName = CATEGORY_ALIAS[cat] || cat;
          const emoji = AREA_EMOJI[cat] || "📋";

          return (
            <div key={cat} className={`backdrop-blur-sm border rounded-2xl shadow-sm overflow-hidden transition-all hover:shadow-md ${
              isApex
                ? "bg-gradient-to-br from-amber-50/80 to-indigo-50/60 dark:from-amber-900/15 dark:to-indigo-900/10 border-amber-300/60 dark:border-amber-700/40 ring-1 ring-amber-200/60 dark:ring-amber-800/30"
                : "bg-white/80 dark:bg-gray-900/80 border-gray-200/60 dark:border-gray-800/60"
            }`}>
              {/* Area header */}
              <div className="px-5 py-3 border-b border-gray-200/60 dark:border-gray-800/60 flex items-center justify-between bg-gradient-to-r from-gray-50/60 to-white/30 dark:from-gray-800/30 dark:to-gray-900/20">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-lg">{emoji}</span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{displayName}</h3>
                    {displayName !== cat && <p className="text-[10px] text-gray-400 truncate">{cat}</p>}
                  </div>
                </div>
                <ScorePill tasks={catTasks} />
              </div>

              {/* Two owner panels */}
              <div className="p-4 space-y-3">
                {owners.map((o) => {
                  const ownedHere = catTasks.filter((t) => t.owner_id === o.id || t.owner?.full_name === o.name);
                  const done = ownedHere.filter((t) => t.status === "completed").length;
                  const clusters = clusterTasks(ownedHere);
                  const headline = areaHeadline(o.name, clusters, ownedHere.length, done);
                  const style = OWNER_STYLE[o.name];
                  const gradientBg = o.name === "Leah"
                    ? "bg-gradient-to-br from-pink-50/70 to-rose-50/40 dark:from-pink-900/15 dark:to-rose-900/10"
                    : "bg-gradient-to-br from-cyan-50/70 to-sky-50/40 dark:from-cyan-900/15 dark:to-sky-900/10";

                  return (
                    <div key={o.id} className={`rounded-xl border border-gray-200/50 dark:border-gray-800/40 ${gradientBg} overflow-hidden`}>
                      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200/40 dark:border-gray-800/30">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ background: `linear-gradient(135deg, ${style?.dot}, ${style?.dot}aa)` }}>
                            {o.name[0]}
                          </span>
                          <span className={`text-xs font-semibold ${style?.text || "text-gray-700 dark:text-gray-300"}`}>{o.name}</span>
                        </div>
                        {ownedHere.length > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-gray-200/70 dark:bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{
                                width: `${(done / Math.max(ownedHere.length, 1)) * 100}%`,
                                backgroundColor: style?.dot,
                              }} />
                            </div>
                            <span className="text-[10px] text-gray-500 whitespace-nowrap">{done}/{ownedHere.length}</span>
                          </div>
                        )}
                      </div>

                      {/* Thoughtful summary headline */}
                      <p className="px-3 pt-2.5 pb-1 text-[11.5px] leading-snug text-gray-700 dark:text-gray-300 italic">
                        {headline}
                      </p>

                      {/* Iteration-first hierarchy: iteration goals (no week_id) are
                          the only top-level bullets. Every week task nests under the
                          best-matching goal in the same iteration+category+owner. When
                          no goal exists, week tasks are deliberately NOT shown here —
                          surfaced as gaps in chat so we can map them manually. */}
                      {ownedHere.length > 0 ? (
                        <div className="px-3 pb-3 pt-1 space-y-3">
                          {buildIterationHierarchy(ownedHere, iterations).filter((b) => b.bullets.length > 0).map((iterBlock) => (
                            <div key={iterBlock.iterationId || "no-iter"} className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                  {iterBlock.iterationName}
                                </span>
                                {iterBlock.totalTasks > 0 && (
                                  <span className="text-[9px] text-gray-400">
                                    {iterBlock.doneTasks}/{iterBlock.totalTasks}
                                  </span>
                                )}
                              </div>
                              <ul className="space-y-1.5 pl-1">
                                {iterBlock.bullets.map((bullet, bi) => {
                                  const doneIn = bullet.childTasks.filter((t) => t.status === "completed").length + (bullet.goalTask && bullet.goalTask.status === "completed" ? 1 : 0);
                                  const total = bullet.childTasks.length + (bullet.goalTask ? 1 : 0);
                                  return (
                                    <li key={bi} className="flex items-start gap-2">
                                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: style?.dot }} />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {bullet.goalTask ? (
                                            <Link href={`/tasks/${bullet.goalTask.id}`}
                                              className="text-[12px] font-medium text-gray-800 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                              {bullet.label}
                                            </Link>
                                          ) : (
                                            <span className="text-[12px] font-medium text-gray-700 dark:text-gray-300">{bullet.label}</span>
                                          )}
                                          {total > 1 && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/60 dark:bg-gray-800/60 text-gray-500">
                                              {doneIn}/{total}
                                            </span>
                                          )}
                                          {bullet.goalTask && (
                                            <span className="text-[8px] uppercase tracking-wider text-gray-400">goal</span>
                                          )}
                                        </div>
                                        {bullet.childTasks.length > 0 && (
                                          <div className="flex flex-wrap gap-1 mt-1">
                                            {bullet.childTasks.map((t) => (
                                              <Link key={t.id} href={`/tasks/${t.id}`}
                                                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-white/70 dark:bg-gray-900/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors border border-gray-200/50 dark:border-gray-700/40">
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[t.status] }} />
                                                <span className="truncate max-w-[180px]">{t.title}</span>
                                              </Link>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="px-3 pb-3 text-[10px] text-gray-400 italic">Yet to be defined.</p>
                      )}
                    </div>
                  );
                })}

                {/* Yet-to-be-defined placeholder for roles beyond Leah + Chloe */}
                <div className="rounded-xl border border-dashed border-gray-300/60 dark:border-gray-700/40 bg-gray-50/30 dark:bg-gray-800/10 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] text-gray-500">?</span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 italic">
                      Additional roles for this area — <span className="font-medium not-italic">yet to be defined</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
              })}
            </div>
          </section>
        );
      })}
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
