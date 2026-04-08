"use client";

import { useApi, apiPatch, apiPost } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { canGiveFeedback, canEditTasks } from "@/lib/roles";
import type { Task, Feedback, Deliverable } from "@/lib/types";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import Link from "next/link";
import { useState } from "react";
import { HiOutlineChatAlt, HiOutlinePaperClip, HiArrowRight, HiCheck, HiReply, HiEye } from "react-icons/hi";

type FeedbackItem = Feedback & { reviewer?: { id: string; full_name: string }; acknowledged?: boolean; acknowledged_by?: string; acknowledged_at?: string };
type FullTask = Task & {
  feedback?: FeedbackItem[];
  deliverables?: (Deliverable & { viewed?: boolean; viewed_at?: string })[];
  owner?: { id: string; full_name: string };
};

export default function FeedbackTrailPage() {
  const { data: tasks, loading, refetch } = useApi<FullTask[]>("/api/tasks");
  const { dbUser, appRole } = useAuth();
  const isDoer = canEditTasks(appRole);
  const isAssessor = canGiveFeedback(appRole);

  const [replyTo, setReplyTo] = useState<{ taskId: string; fbId: string } | null>(null);
  const [replyText, setReplyText] = useState("");

  if (loading) return <div className="p-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500" /></div>;

  const all = tasks || [];

  // Build per-task feedback threads
  const threadsMap = new Map<string, { task: FullTask; feedbacks: FeedbackItem[] }>();
  for (const task of all) {
    if (task.feedback && task.feedback.length > 0) {
      threadsMap.set(task.id, { task, feedbacks: [...task.feedback].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) });
    }
  }
  const threads = Array.from(threadsMap.values()).sort((a, b) => {
    const aLatest = a.feedbacks[a.feedbacks.length - 1]?.created_at || "";
    const bLatest = b.feedbacks[b.feedbacks.length - 1]?.created_at || "";
    return new Date(bLatest).getTime() - new Date(aLatest).getTime();
  });

  // Stats
  const totalThreads = threads.length;
  const totalFeedback = threads.reduce((s, t) => s + t.feedbacks.length, 0);
  const unacknowledged = threads.reduce((s, t) => s + t.feedbacks.filter((f) => !f.acknowledged && !f.comment?.startsWith("↩️")).length, 0);
  const tasksWithDeliverables = all.filter((t) => (t.deliverables?.length || 0) > 0 && !(t.feedback?.length)).length;
  const unviewedDeliverables = all.reduce((s, t) => s + (t.deliverables || []).filter((d) => !d.viewed).length, 0);

  async function acknowledge(fbId: string) {
    try {
      await apiPatch(`/api/feedback/${fbId}`, { acknowledged: true, acknowledged_by: dbUser?.id });
      await refetch();
    } catch {}
  }

  async function markDeliverableViewed(delId: string) {
    try {
      await apiPatch(`/api/deliverables/${delId}`, { viewed: true });
      await refetch();
    } catch {}
  }

  async function submitReply() {
    if (!replyTo || !replyText || !dbUser) return;
    try {
      const orig = threadsMap.get(replyTo.taskId)?.feedbacks.find((f) => f.id === replyTo.fbId);
      await apiPost("/api/feedback", {
        task_id: replyTo.taskId, reviewer_id: dbUser.id, rating: orig?.rating || 5,
        comment: `↩️ Reply to ${orig?.reviewer?.full_name}: ${replyText}`, tag: "approved",
      });
      setReplyTo(null); setReplyText("");
      await refetch();
    } catch {}
  }

  const tagColors: Record<string, string> = {
    approved: "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400",
    needs_improvement: "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400",
    blocked: "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400",
  };

  function fmtTime(d: string) {
    return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold gradient-text">Feedback Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">All feedback threads across tasks — interact, acknowledge, and respond</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-4 stagger-children">
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-4 interactive">
          <p className="text-xs text-gray-500">Threads</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalThreads}</p>
        </div>
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-4 interactive">
          <p className="text-xs text-gray-500">Total Feedback</p>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{totalFeedback}</p>
        </div>
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-yellow-200/60 dark:border-yellow-800/30 rounded-2xl p-4 interactive bg-gradient-to-br from-yellow-50 to-amber-50/50 dark:from-yellow-900/10 dark:to-amber-900/5">
          <p className="text-xs text-yellow-600 dark:text-yellow-400">Unacknowledged</p>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{unacknowledged}</p>
        </div>
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-blue-200/60 dark:border-blue-800/30 rounded-2xl p-4 interactive bg-gradient-to-br from-blue-50 to-cyan-50/50 dark:from-blue-900/10 dark:to-cyan-900/5">
          <p className="text-xs text-blue-600 dark:text-blue-400">Unviewed Files</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{unviewedDeliverables}</p>
        </div>
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-violet-200/60 dark:border-violet-800/30 rounded-2xl p-4 interactive bg-gradient-to-br from-violet-50 to-purple-50/50 dark:from-violet-900/10 dark:to-purple-900/5">
          <p className="text-xs text-violet-600 dark:text-violet-400">Awaiting Review</p>
          <p className="text-2xl font-bold text-violet-700 dark:text-violet-400">{tasksWithDeliverables}</p>
        </div>
      </div>

      {/* Tasks awaiting review — for assessors */}
      {isAssessor && tasksWithDeliverables > 0 && (
        <div className="bg-gradient-to-r from-violet-50 to-purple-50/50 dark:from-violet-900/10 dark:to-purple-900/5 border border-violet-200/60 dark:border-violet-800/30 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-violet-700 dark:text-violet-400 mb-3">📋 Deliverables Needing Your Review</h2>
          <div className="space-y-2">
            {all.filter((t) => (t.deliverables?.length || 0) > 0 && !(t.feedback?.length)).slice(0, 8).map((t) => (
              <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center gap-3 py-2 px-3 hover:bg-violet-100/50 dark:hover:bg-violet-900/10 rounded-xl transition-all">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[t.status] }} />
                <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">{t.title}</span>
                {(t.deliverables || []).map((d) => (
                  <span key={d.id} className={`w-3 h-3 rounded-full flex-shrink-0 ${d.viewed ? "bg-green-500" : "bg-blue-500 animate-pulse-subtle"}`} title={d.viewed ? "Viewed" : "Not yet viewed"} />
                ))}
                <span className="text-[10px] text-gray-400">{t.deliverables?.length} file(s)</span>
                <HiArrowRight className="w-3 h-3 text-gray-400" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Feedback Threads */}
      {threads.length === 0 ? (
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-8 text-center">
          <HiOutlineChatAlt className="w-10 h-10 text-violet-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-1">No feedback yet</h3>
          <p className="text-sm text-gray-500">Feedback from reps will appear here as threaded conversations.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">Feedback Threads ({totalThreads})</h2>
          {threads.map(({ task, feedbacks }) => {
            const unack = feedbacks.filter((f) => !f.acknowledged && !f.comment?.startsWith("↩️")).length;
            return (
              <div key={task.id} className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm overflow-hidden transition-all hover:shadow-md">
                {/* Task header — clickable card */}
                <Link href={`/tasks/${task.id}`} className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-all">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[task.status] }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-800 dark:text-white truncate block">{task.title}</span>
                    <span className="text-[10px] text-gray-400">{task.category} · {task.owner?.full_name || "Unassigned"}</span>
                  </div>
                  {/* Deliverable indicators */}
                  <div className="flex gap-1">
                    {(task.deliverables || []).map((d) => (
                      <span key={d.id} className={`w-2.5 h-2.5 rounded-full ${d.viewed ? "bg-green-500" : "bg-blue-500"}`} title={d.viewed ? "Viewed ✓" : "Not viewed"} />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] text-gray-400">{feedbacks.length} msgs</span>
                    {unack > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 rounded-full font-semibold">{unack} new</span>}
                    <HiArrowRight className="w-3.5 h-3.5 text-gray-400" />
                  </div>
                </Link>

                {/* Feedback messages — chronological */}
                <div className="px-5 py-3 space-y-3 max-h-96 overflow-y-auto">
                  {feedbacks.map((fb) => {
                    const isReply = fb.comment?.startsWith("↩️");
                    return (
                      <div key={fb.id} className={`${isReply ? "ml-8 pl-3 border-l-2 border-indigo-300 dark:border-indigo-600" : ""}`}>
                        <div className="flex items-start gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mt-0.5">
                            {fb.reviewer?.full_name?.[0] || "?"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{fb.reviewer?.full_name}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${tagColors[fb.tag] || ""}`}>{fb.tag.replace("_", " ")}</span>
                              {!isReply && <span className="text-xs font-bold text-gray-900 dark:text-white">{fb.rating}/10</span>}
                              <span className="text-[9px] text-gray-400">{fmtTime(fb.created_at)}</span>
                              {fb.acknowledged && <span className="text-[9px] text-green-500 flex items-center gap-0.5"><HiCheck className="w-3 h-3" /> Acknowledged</span>}
                            </div>
                            {fb.comment && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">{fb.comment}</p>}

                            {/* Actions */}
                            <div className="flex items-center gap-3 mt-1.5">
                              {/* Doer: Acknowledge */}
                              {isDoer && !fb.acknowledged && !isReply && (
                                <button onClick={() => acknowledge(fb.id)} className="text-[10px] text-green-600 hover:text-green-500 flex items-center gap-0.5 transition-colors">
                                  <HiCheck className="w-3 h-3" /> Acknowledge
                                </button>
                              )}
                              {/* Reply */}
                              {!isReply && (
                                <button onClick={() => setReplyTo({ taskId: task.id, fbId: fb.id })} className="text-[10px] text-gray-400 hover:text-indigo-500 flex items-center gap-0.5 transition-colors">
                                  <HiReply className="w-3 h-3" /> Reply
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Inline reply */}
                        {replyTo?.fbId === fb.id && (
                          <div className="flex gap-2 mt-2 ml-10">
                            <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Reply..." autoFocus
                              className="flex-1 px-3 py-1.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white"
                              onKeyDown={(e) => e.key === "Enter" && submitReply()} />
                            <button onClick={submitReply} className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-xs rounded-xl">Send</button>
                            <button onClick={() => { setReplyTo(null); setReplyText(""); }} className="text-xs text-gray-400">Cancel</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Mark deliverables as viewed — for assessors */}
                {isAssessor && (task.deliverables || []).some((d) => !d.viewed) && (
                  <div className="px-5 py-2 border-t border-gray-100 dark:border-gray-800 bg-blue-50/30 dark:bg-blue-900/5">
                    <div className="flex items-center gap-2">
                      <HiEye className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-[10px] text-blue-600 dark:text-blue-400">Unviewed deliverables:</span>
                      {(task.deliverables || []).filter((d) => !d.viewed).map((d) => (
                        <button key={d.id} onClick={() => markDeliverableViewed(d.id)}
                          className="text-[10px] text-blue-500 hover:text-blue-400 underline">{d.title}</button>
                      ))}
                    </div>
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
