"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Task, TaskStatus, Deliverable } from "@/lib/types";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { canGiveFeedback } from "@/lib/roles";
import { Card, KPICard, ProgressBar, ScorePill, SkeletonRows, EmptyState } from "@/components/ui";
import ScoreEditor from "@/components/ScoreEditor";
import Link from "next/link";
import { HiArrowRight, HiOutlinePaperClip } from "react-icons/hi";

type ScoreOverride = { target_type: string; target_id: string; score: number };

function score(tasks: Task[]): number {
  if (!tasks.length) return 0;
  return (tasks.filter((t) => t.status === "completed").length / tasks.length) * 10;
}

type FullTask = Task & { deliverables?: Deliverable[]; feedback?: { id: string }[] };

export default function DashboardPage() {
  const { appRole } = useAuth();
  const isAssessor = canGiveFeedback(appRole);
  const [selectedIter, setSelectedIter] = useState<string | null>(null);
  const { data: tasks, loading } = useApi<FullTask[]>("/api/tasks");
  const { data: quarters } = useApi<{ id: string; name: string; start_date: string; end_date: string; iterations: { id: string; name: string; iteration_number: number; start_date: string; end_date: string }[] }[]>("/api/quarters");
  const { data: users } = useApi<{ id: string; full_name: string; email: string }[]>("/api/users/owners");
  const { data: scoreOverrides, refetch: refetchScores } = useApi<ScoreOverride[]>("/api/scores");
  const { data: quarterGoals } = useApi<{ id: string; category: string; goal: string }[]>("/api/quarter-goals");

  if (loading) return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="h-8 skeleton w-48" />
      <div className="grid grid-cols-5 gap-4">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>
      <div className="skeleton h-40 rounded-2xl" />
    </div>
  );

  const all = tasks || [];
  const total = all.length;
  const completed = all.filter((t) => t.status === "completed").length;
  const inProgress = all.filter((t) => t.status === "in_progress").length;
  const notStarted = all.filter((t) => t.status === "not_started").length;
  const blocked = all.filter((t) => t.status === "blocked").length;
  const underReview = all.filter((t) => t.status === "under_review").length;
  const overdue = all.filter((t) => t.deadline && new Date(t.deadline) < new Date() && t.status !== "completed");
  const lowRated = all.filter((t) => {
    const fb = (t as Task & { feedback?: { rating: number }[] }).feedback;
    if (!fb?.length) return false;
    return fb.reduce((s, f) => s + f.rating, 0) / fb.length < 6;
  });
  const quarterScore = score(all);
  const quarter = quarters?.[0];
  const overrides = scoreOverrides || [];
  function getOverride(type: string, id: string) { return overrides.find((o) => o.target_type === type && o.target_id === id) || null; }
  const iterations = quarter?.iterations || [];
  const categories = [...new Set(all.map((t) => t.category).filter(Boolean))];

  if (total === 0) return (
    <div className="p-8">
      <h1 className="text-2xl font-bold gradient-text mb-6">Dashboard</h1>
      <Card className="p-0">
        <EmptyState title="No tasks yet" description="Upload a CSV or create tasks to see your dashboard come alive." action={
          <Link href="/upload" className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm rounded-xl shadow-md hover:shadow-lg transition-all">Upload CSV</Link>
        } />
      </Card>
    </div>
  );

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold gradient-text">Dashboard</h1>
          {quarter && <p className="text-sm text-gray-500 mt-0.5">{quarter.name}</p>}
        </div>
        <div className="text-right">
          {quarter ? (
            <ScoreEditor targetType="quarter" targetId={quarter.id} cumulativeScore={quarterScore}
              override={getOverride("quarter", quarter.id)} onUpdate={refetchScores} size="lg" />
          ) : (
            <div className="text-3xl font-bold text-gray-900 dark:text-white">{quarterScore.toFixed(1)}<span className="text-lg text-gray-400">/10</span></div>
          )}
          <p className="text-[11px] text-gray-500 mt-1">Quarter Score</p>
        </div>
      </div>

      {/* KPIs — click to navigate to filtered tasks */}
      <div className="grid grid-cols-5 gap-4 stagger-children">
        <Link href="/tasks"><KPICard label="Total Goals" value={total} /></Link>
        <Link href="/tasks?status=completed"><KPICard label="Completed" value={completed} color="text-green-600 dark:text-green-400" accent="green" /></Link>
        <Link href="/tasks?status=in_progress"><KPICard label="In Progress" value={inProgress} color="text-blue-600 dark:text-blue-400" accent="blue" /></Link>
        <Link href="/tasks?status=not_started"><KPICard label="Not Started" value={notStarted} /></Link>
        <Link href="/tasks?status=blocked"><KPICard label="Obstacle" value={blocked} color="text-red-600 dark:text-red-400" accent="red" /></Link>
      </div>

      {/* Assessor: Fresh deliverables needing feedback */}
      {isAssessor && (() => {
        const needsReview = all.filter((t) => (t.deliverables?.length || 0) > 0 && !(t.feedback?.length));
        if (needsReview.length === 0) return null;
        return (
          <Card className="p-5 border-violet-200/60 dark:border-violet-800/30 bg-gradient-to-r from-violet-50/50 to-purple-50/30 dark:from-violet-900/10 dark:to-purple-900/5">
            <h2 className="text-sm font-semibold text-violet-700 dark:text-violet-400 mb-3">📋 New Deliverables — Needs Your Feedback ({needsReview.length})</h2>
            <div className="space-y-2">
              {needsReview.slice(0, 10).map((t) => {
                const latestDel = (t.deliverables || []).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
                return (
                  <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-violet-100/50 dark:hover:bg-violet-900/10 transition-all group">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[t.status] }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate block group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{t.title}</span>
                      {latestDel && <span className="text-[10px] text-gray-400">{latestDel.title} · uploaded {new Date(latestDel.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
                    </div>
                    <HiOutlinePaperClip className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <span className="text-[10px] text-gray-400">{t.deliverables?.length} file(s)</span>
                    <HiArrowRight className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                );
              })}
            </div>
          </Card>
        );
      })()}

      {/* Iteration Progress — click to see goals */}
      {iterations.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4">Iteration Progress</h2>
          <div className="grid grid-cols-4 gap-4 stagger-children">
            {iterations.map((iter) => {
              const iterTasks = all.filter((t) => t.iteration_id === iter.id);
              const done = iterTasks.filter((t) => t.status === "completed").length;
              const pct = iterTasks.length ? Math.round((done / iterTasks.length) * 100) : 0;
              const isSelected = selectedIter === iter.id;
              return (
                <button key={iter.id} onClick={() => setSelectedIter(isSelected ? null : iter.id)}
                  className={`space-y-2 text-left p-3 rounded-xl transition-all ${isSelected ? "bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-300 dark:ring-indigo-700" : "hover:bg-gray-50 dark:hover:bg-gray-800/30"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{iter.name}</span>
                    <ScoreEditor targetType="iteration" targetId={iter.id} cumulativeScore={score(iterTasks)}
                      override={getOverride("iteration", iter.id)} onUpdate={refetchScores} />
                  </div>
                  <ProgressBar value={pct} />
                  <span className="text-[10px] text-gray-400">{done}/{iterTasks.length} completed</span>
                </button>
              );
            })}
          </div>

          {/* Selected iteration goals */}
          {selectedIter && (() => {
            const iter = iterations.find((i) => i.id === selectedIter);
            if (!iter) return null;
            const iterTasks = all.filter((t) => t.iteration_id === selectedIter && !t.week_id);
            if (iterTasks.length === 0) return null;
            return (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 animate-fade-in">
                <h3 className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2">{iter.name} — Goals / Outcomes</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  {iterTasks.map((t) => (
                    <div key={t.id} className="flex items-start gap-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[t.status] }} />
                      <Link href={`/tasks/${t.id}`} className="text-[11px] text-gray-600 dark:text-gray-400 hover:text-indigo-500 transition-colors leading-relaxed">{t.title}</Link>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </Card>
      )}

      {/* Goals by Category — fixed 6 categories, quarter goals + iteration goals */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4">Goals by Category</h2>
        <div className="space-y-5">
          {["Customer Success & PG Acquisition", "Product / Engineering / Workflows", "Cybersecurity", "Continuous Learning", "Talent Acquisition", "Branding"].map((cat) => {
            const catTasks = all.filter((t) => t.category === cat);
            const done = catTasks.filter((t) => t.status === "completed").length;
            const ip = catTasks.filter((t) => t.status === "in_progress").length;
            const pct = catTasks.length ? Math.round(((done + ip * 0.5) / catTasks.length) * 100) : 0;
            const catQGoals = (quarterGoals || []).filter((g) => g.category === cat);
            return (
              <div key={cat} className="animate-fade-in">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-gray-800 dark:text-white">{cat}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400">{done}/{catTasks.length}</span>
                    <ScorePill score={score(catTasks)} />
                  </div>
                </div>
                <ProgressBar value={pct} size="sm" />
                {catQGoals.length > 0 && (
                  <div className="mt-2 space-y-1 ml-1">
                    {catQGoals.map((g) => (
                      <div key={g.id} className="flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 dark:bg-indigo-500 mt-1.5 flex-shrink-0" />
                        <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{g.goal}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Team */}
      {(users?.length || 0) > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4">Team</h2>
          <div className="grid grid-cols-4 gap-3 stagger-children">
            {(users || []).map((u) => {
              const userTasks = all.filter((t) => t.owner_id === u.id);
              const done = userTasks.filter((t) => t.status === "completed").length;
              return (
                <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50/80 dark:bg-gray-800/50 interactive">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                    {u.full_name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name}</p>
                    <p className="text-[10px] text-gray-400">{userTasks.length} tasks · {done} done</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Overdue */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 mb-3">⚠️ Overdue ({overdue.length})</h2>
          {overdue.length === 0 ? <p className="text-sm text-gray-400">None — great work!</p> : (
            <ul className="space-y-1.5">
              {overdue.slice(0, 6).map((t) => (
                <li key={t.id}><Link href={`/tasks/${t.id}`} className="text-sm text-gray-700 dark:text-gray-300 hover:text-indigo-500 transition-colors">{t.title}</Link></li>
              ))}
            </ul>
          )}
        </Card>

        {/* Status Distribution */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3">Status Distribution</h2>
          <div className="flex gap-0.5 h-6 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 mb-3">
            {([
              { s: "completed" as TaskStatus, c: completed },
              { s: "in_progress" as TaskStatus, c: inProgress },
              { s: "under_review" as TaskStatus, c: underReview },
              { s: "not_started" as TaskStatus, c: notStarted },
              { s: "blocked" as TaskStatus, c: blocked },
            ]).filter((x) => x.c > 0).map(({ s, c }) => (
              <div key={s} className="h-full transition-all duration-500" style={{ width: `${(c / total) * 100}%`, backgroundColor: STATUS_COLORS[s] }} title={`${STATUS_LABELS[s]}: ${c}`} />
            ))}
          </div>
          <div className="flex gap-4 flex-wrap">
            {(Object.entries(STATUS_LABELS) as [TaskStatus, string][]).map(([s, l]) => {
              const c = all.filter((t) => t.status === s).length;
              return c > 0 ? (
                <span key={s} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />{l} ({c})
                </span>
              ) : null;
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
