"use client";

import { useApi, apiPatch, apiPost, apiDelete, invalidateCache } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { canGiveFeedback, canEditTasks } from "@/lib/roles";
import type { Task, Feedback, Deliverable } from "@/lib/types";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import Link from "next/link";
import { useState, useRef, useEffect, useMemo } from "react";
import { HiOutlineChatAlt, HiOutlinePaperClip, HiArrowRight, HiCheck, HiReply, HiEye, HiX, HiAtSymbol, HiOutlineFilm } from "react-icons/hi";
import { useToast, Skeleton, SkeletonRows } from "@/components/ui";
import { handleApiError, isReplyComment, isVideoUrl } from "@/lib/utils";

type FeedbackItem = Feedback & { reviewer?: { id: string; full_name: string }; acknowledged?: boolean; acknowledged_by?: string; acknowledged_at?: string };
type FullTask = Task & {
  feedback?: FeedbackItem[];
  deliverables?: (Deliverable & { viewed?: boolean; viewed_at?: string })[];
  owner?: { id: string; full_name: string };
};

type FilterType = "all" | "unacknowledged" | "awaiting_review" | "new_messages" | null;

type WeekReport = {
  id: string;
  week_id: string;
  report_type: "wednesday" | "saturday";
  content: string;
  file_url?: string;
  submitted_by: string;
  created_at: string;
  submitted_by_user?: { id: string; full_name: string };
  feedback?: { id: string; reviewer_id: string; rating: number; comment?: string; created_at: string; reviewer?: { id: string; full_name: string } }[];
};

type ChatMessage = { id: string; user_id: string; message: string; mentions?: string[]; parent_id?: string; created_at: string; user?: { id: string; full_name: string; email: string } };
type TeamUser = { id: string; full_name: string; email: string };

export default function FeedbackTrailPage() {
  const { data: tasks, loading, refetch } = useApi<FullTask[]>("/api/tasks");
  const { data: weekReports } = useApi<WeekReport[]>("/api/week-reports");
  const { data: chatData, refetch: refetchChat } = useApi<ChatMessage[]>("/api/chat");
  const { data: teamUsers } = useApi<TeamUser[]>("/api/users");
  const { dbUser, appRole } = useAuth();
  const { toast } = useToast();
  const isDoer = canEditTasks(appRole);
  const isAssessor = canGiveFeedback(appRole);

  const [replyTo, setReplyTo] = useState<{ taskId: string; fbId: string } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>(null);
  const [activeTab, setActiveTab] = useState<"task_feedback" | "team_scores" | "general_chat">("task_feedback");

  // General Chat state
  const [chatMsg, setChatMsg] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [editingChat, setEditingChat] = useState<string | null>(null);
  const [editChatText, setEditChatText] = useState("");
  const [chatReplyTo, setChatReplyTo] = useState<{ id: string; userName: string; preview: string } | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const chatMessages = chatData || [];
  const all = tasks || [];

  // Build per-task feedback threads (must be before any early return)
  const threads = useMemo(() => {
    const threadsMap = new Map<string, { task: FullTask; feedbacks: FeedbackItem[] }>();
    for (const task of all) {
      if (task.feedback && task.feedback.length > 0) {
        threadsMap.set(task.id, { task, feedbacks: [...task.feedback].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) });
      }
    }
    return Array.from(threadsMap.values()).sort((a, b) => {
      const aLatest = a.feedbacks[a.feedbacks.length - 1]?.created_at || "";
      const bLatest = b.feedbacks[b.feedbacks.length - 1]?.created_at || "";
      return new Date(bLatest).getTime() - new Date(aLatest).getTime();
    });
  }, [all]);

  // Stats (must be before any early return)
  const { totalThreads, totalFeedback, unacknowledged, awaitingReviewTasks, tasksWithDeliverables, newForMe } = useMemo(() => {
    const totalThreads = threads.length;
    const taskFeedbackCount = threads.reduce((s, t) => s + t.feedbacks.filter((f) => !isReplyComment(f.comment)).length, 0);
    const wrList = weekReports || [];
    const weekReportFeedbackCount = wrList.reduce((s, wr) => s + (wr.feedback?.length || 0), 0);
    const totalFeedback = taskFeedbackCount + weekReportFeedbackCount;
    const unacknowledged = threads.reduce((s, t) => s + t.feedbacks.filter((f) => !f.acknowledged && !isReplyComment(f.comment)).length, 0);
    const awaitingReviewTasks = all.filter((t) => (t.deliverables?.length || 0) > 0 && !(t.feedback?.length));
    const weekReportsAwaitingReview = wrList.filter((wr) => !(wr.feedback?.length));
    const tasksWithDeliverables = awaitingReviewTasks.length + weekReportsAwaitingReview.length;

    // New messages: threads where last message is from the other side
    const myEmail = dbUser?.email || "";
    const iAmRep = myEmail.endsWith("@mimimomentum.com");
    let newForMe = 0;
    for (const t of threads) {
      if (t.feedbacks.length === 0) continue;
      const last = t.feedbacks[t.feedbacks.length - 1];
      const lastIsRep = last.reviewer?.full_name === "Rep 1" || last.reviewer?.full_name === "Rep 2";
      if (iAmRep && !lastIsRep) newForMe++; // doer replied, rep hasn't responded
      if (!iAmRep && lastIsRep) newForMe++; // rep sent feedback, doer hasn't replied
    }

    return { totalThreads, totalFeedback, unacknowledged, awaitingReviewTasks, tasksWithDeliverables, newForMe };
  }, [threads, all, weekReports, dbUser?.email]);

  // Per-owner feedback scores with task-level drilldown
  const ownerScores = useMemo(() => {
    const scores = new Map<string, { name: string; ratings: number[]; taskCount: number; feedbackCount: number; tasks: { task: FullTask; avgRating: number; feedbacks: FeedbackItem[] }[] }>();
    for (const t of threads) {
      const ownerName = t.task.owner?.full_name || "Unassigned";
      if (!scores.has(ownerName)) scores.set(ownerName, { name: ownerName, ratings: [], taskCount: 0, feedbackCount: 0, tasks: [] });
      const entry = scores.get(ownerName)!;
      entry.taskCount++;
      const repFeedback = t.feedbacks.filter(f => !isReplyComment(f.comment));
      entry.feedbackCount += repFeedback.length;
      repFeedback.forEach(f => entry.ratings.push(f.rating));
      const taskAvg = repFeedback.length > 0 ? repFeedback.reduce((a, f) => a + f.rating, 0) / repFeedback.length : 0;
      entry.tasks.push({ task: t.task, avgRating: taskAvg, feedbacks: repFeedback });
    }
    return [...scores.values()].map(s => ({
      ...s,
      avgRating: s.ratings.length > 0 ? s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length : 0,
      tasks: s.tasks.sort((a, b) => b.avgRating - a.avgRating),
    })).sort((a, b) => b.avgRating - a.avgRating);
  }, [threads]);

  const [expandedOwner, setExpandedOwner] = useState<string | null>(null);

  const overallAvg = useMemo(() => {
    const allRatings = ownerScores.flatMap(s => s.ratings);
    return allRatings.length > 0 ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : 0;
  }, [ownerScores]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeTab === "general_chat") chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length, activeTab]);

  if (loading) return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="skeleton h-8 w-56" />
      <div className="grid grid-cols-5 gap-4">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>
      <SkeletonRows count={5} />
    </div>
  );

  // Filter logic — applied to threads
  function getFilteredThreads() {
    if (!activeFilter || activeFilter === "all") return threads;
    if (activeFilter === "unacknowledged") {
      return threads.filter(t => t.feedbacks.some(f => !f.acknowledged && !isReplyComment(f.comment)));
    }
    if (activeFilter === "new_messages") {
      const myEmail = dbUser?.email || "";
      const iAmRep = myEmail.endsWith("@mimimomentum.com");
      return threads.filter(t => {
        if (t.feedbacks.length === 0) return false;
        const last = t.feedbacks[t.feedbacks.length - 1];
        const lastIsRep = last.reviewer?.full_name === "Rep 1" || last.reviewer?.full_name === "Rep 2";
        return iAmRep ? !lastIsRep : lastIsRep;
      });
    }
    return threads;
  }

  const filteredThreads = getFilteredThreads();

  // For "awaiting_review" filter, we show tasks with deliverables but no feedback
  const showAwaitingReview = activeFilter === "awaiting_review";

  function toggleFilter(filter: FilterType) {
    setActiveFilter(prev => prev === filter ? null : filter);
  }

  async function acknowledge(fbId: string) {
    try {
      await apiPatch(`/api/feedback/${fbId}`, { acknowledged: true, acknowledged_by: dbUser?.id });
      invalidateCache("/api/tasks", "/api/stats");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function markDeliverableViewed(delId: string) {
    try {
      await apiPatch(`/api/deliverables/${delId}`, { viewed: true });
      invalidateCache("/api/tasks", "/api/stats");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function submitReply() {
    if (!replyTo || !replyText) return;
    if (!dbUser) { toast("Session not ready — please refresh the page", "error"); return; }
    setReplyError("");
    try {
      const orig = threads.find((t) => t.task.id === replyTo.taskId)?.feedbacks.find((f) => f.id === replyTo.fbId);
      // Slack/Gchat-style: anchor reply to the specific message via parent_id.
      // Keep the legacy "↩️" prefix in the comment so old logic counting
      // unacknowledged via isReplyComment continues to exclude replies.
      await apiPost("/api/feedback", {
        task_id: replyTo.taskId,
        reviewer_id: dbUser.id,
        rating: orig?.rating || 5,
        comment: `↩️ ${replyText}`,
        tag: "approved",
        parent_id: replyTo.fbId,
      });
      setReplyTo(null); setReplyText("");
      invalidateCache("/api/tasks", "/api/stats");
      await refetch();
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : "Reply failed");
    }
  }

  const tagColors: Record<string, string> = {
    approved: "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400",
    needs_improvement: "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400",
    blocked: "bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400",
  };

  function fmtTime(d: string) {
    return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  // Extract @mentions from message text and resolve to user IDs
  function extractMentionIds(text: string): string[] {
    const mentionNames = [...text.matchAll(/@([A-Za-z\s]+?)(?=\s|$|@)/g)].map(m => m[1].trim());
    return mentionNames.map(name => (teamUsers || []).find(u => u.full_name.toLowerCase() === name.toLowerCase())?.id).filter(Boolean) as string[];
  }

  // Render message with highlighted @mentions
  function renderMentions(text: string) {
    const parts = text.split(/(@[A-Za-z\s]+?)(?=\s|$|@)/g);
    return parts.map((part, i) =>
      part.startsWith("@") ? <span key={i} className="text-indigo-400 font-medium">{part}</span> : <span key={i}>{part}</span>
    );
  }

  async function sendChat() {
    if (!chatMsg.trim()) return;
    if (!dbUser) { toast("Session not ready — please refresh the page", "error"); return; }
    setChatSending(true);
    try {
      const mentions = extractMentionIds(chatMsg);
      await apiPost("/api/chat", {
        user_id: dbUser.id,
        message: chatMsg,
        mentions,
        parent_id: chatReplyTo?.id || null,
      });
      setChatMsg("");
      setShowMentions(false);
      setChatReplyTo(null);
      await refetchChat();
    } catch (e) { toast(handleApiError(e), "error"); }
    setChatSending(false);
  }

  async function updateChatMsg(msgId: string) {
    if (!editChatText.trim()) return;
    try {
      await apiPatch(`/api/chat/${msgId}`, { message: editChatText });
      setEditingChat(null); setEditChatText("");
      await refetchChat();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function deleteChatMsg(msgId: string) {
    if (!confirm("Delete this message?")) return;
    try {
      await apiDelete(`/api/chat/${msgId}`);
      await refetchChat();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  // Counts for sidebar badge
  const totalNewItems = unacknowledged + tasksWithDeliverables;

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold gradient-text">Feedback Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">All feedback threads across tasks — interact, acknowledge, and respond</p>
      </div>

      {/* KPI Cards — clickable filters */}
      <div className="grid grid-cols-5 gap-4 stagger-children">
        <button onClick={() => toggleFilter("all")}
          className={`text-left bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border rounded-2xl p-4 interactive transition-all ${
            activeFilter === "all" || !activeFilter ? "border-gray-300 dark:border-gray-600 ring-1 ring-gray-300 dark:ring-gray-600" : "border-gray-200/60 dark:border-gray-800/60"
          }`}>
          <p className="text-xs text-gray-500">Threads</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalThreads}</p>
        </button>
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-4">
          <p className="text-xs text-gray-500">Total Feedback</p>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{totalFeedback}</p>
        </div>
        <button onClick={() => toggleFilter("new_messages")}
          className={`text-left rounded-2xl p-4 interactive transition-all ${
            activeFilter === "new_messages"
              ? "bg-gradient-to-br from-emerald-100 to-green-100 dark:from-emerald-900/20 dark:to-green-900/15 border-2 border-emerald-400 dark:border-emerald-600 ring-1 ring-emerald-400"
              : "bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-emerald-200/60 dark:border-emerald-800/30 bg-gradient-to-br from-emerald-50 to-green-50/50 dark:from-emerald-900/10 dark:to-green-900/5"
          }`}>
          <p className="text-xs text-emerald-600 dark:text-emerald-400">New for You</p>
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{newForMe}</p>
          {activeFilter === "new_messages" && <p className="text-[9px] text-emerald-500 mt-1">Filter active</p>}
        </button>
        <button onClick={() => toggleFilter("unacknowledged")}
          className={`text-left rounded-2xl p-4 interactive transition-all ${
            activeFilter === "unacknowledged"
              ? "bg-gradient-to-br from-yellow-100 to-amber-100 dark:from-yellow-900/20 dark:to-amber-900/15 border-2 border-yellow-400 dark:border-yellow-600 ring-1 ring-yellow-400"
              : "bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-yellow-200/60 dark:border-yellow-800/30 bg-gradient-to-br from-yellow-50 to-amber-50/50 dark:from-yellow-900/10 dark:to-amber-900/5"
          }`}>
          <p className="text-xs text-yellow-600 dark:text-yellow-400">Unacknowledged</p>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{unacknowledged}</p>
          {activeFilter === "unacknowledged" && <p className="text-[9px] text-yellow-500 mt-1">Filter active</p>}
        </button>
        <button onClick={() => toggleFilter("awaiting_review")}
          className={`text-left rounded-2xl p-4 interactive transition-all ${
            activeFilter === "awaiting_review"
              ? "bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/20 dark:to-purple-900/15 border-2 border-violet-400 dark:border-violet-600 ring-1 ring-violet-400"
              : "bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-violet-200/60 dark:border-violet-800/30 bg-gradient-to-br from-violet-50 to-purple-50/50 dark:from-violet-900/10 dark:to-purple-900/5"
          }`}>
          <p className="text-xs text-violet-600 dark:text-violet-400">Awaiting Review</p>
          <p className="text-2xl font-bold text-violet-700 dark:text-violet-400">{tasksWithDeliverables}</p>
          {activeFilter === "awaiting_review" && <p className="text-[9px] text-violet-500 mt-1">Filter active</p>}
        </button>
      </div>

      {/* Active filter indicator */}
      {activeFilter && activeFilter !== "all" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Filtering by:</span>
          <span className="text-xs px-2.5 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-full font-medium">
            {activeFilter === "unacknowledged" ? "Unacknowledged feedback" : activeFilter === "new_messages" ? "New messages for you" : "Awaiting review"}
          </span>
          <button onClick={() => setActiveFilter(null)} className="text-gray-400 hover:text-gray-600 transition-colors"><HiX className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Tabs: Task Feedback / General Chat */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        <button onClick={() => setActiveTab("task_feedback")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${activeTab === "task_feedback" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          Task Feedback
          {newForMe > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500 text-white rounded-full font-bold min-w-[18px] text-center">{newForMe}</span>}
          {newForMe === 0 && totalFeedback > 0 && <span className="text-[10px] text-gray-400">({totalFeedback})</span>}
        </button>
        <button onClick={() => setActiveTab("team_scores")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${activeTab === "team_scores" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          Team Scores
          {overallAvg > 0 && <span className="text-[10px] font-bold text-gray-400">({overallAvg.toFixed(1)}/10)</span>}
        </button>
        <button onClick={() => setActiveTab("general_chat")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${activeTab === "general_chat" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          General Chat
          {chatMessages.length > 0 && <span className="text-[10px] text-gray-400">({chatMessages.length})</span>}
        </button>
      </div>

      {/* ===== TEAM SCORES TAB ===== */}
      {activeTab === "team_scores" && (
        <div className="space-y-6 max-w-2xl">
          {/* Overall score card */}
          <div className="bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/15 dark:to-violet-900/10 border border-indigo-200/60 dark:border-indigo-800/30 rounded-2xl p-6 text-center">
            <p className="text-xs text-indigo-500 dark:text-indigo-400 uppercase font-semibold tracking-wider mb-1">Overall Team Score</p>
            <p className="text-5xl font-bold text-indigo-600 dark:text-indigo-400">{overallAvg.toFixed(1)}<span className="text-lg text-indigo-400 dark:text-indigo-500">/10</span></p>
            <p className="text-xs text-gray-500 mt-2">Based on {ownerScores.reduce((s, o) => s + o.feedbackCount, 0)} feedback entries across {ownerScores.reduce((s, o) => s + o.taskCount, 0)} tasks</p>
          </div>

          {/* Per-owner breakdown */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400">Individual Scores</h3>
            {ownerScores.length === 0 ? (
              <div className="bg-white/80 dark:bg-gray-900/80 border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-8 text-center">
                <p className="text-sm text-gray-400">No feedback scores yet</p>
              </div>
            ) : ownerScores.map((owner) => {
              const scoreColor = owner.avgRating >= 7 ? "text-green-600 dark:text-green-400" : owner.avgRating >= 4 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
              const barColor = owner.avgRating >= 7 ? "bg-green-500" : owner.avgRating >= 4 ? "bg-yellow-500" : "bg-red-500";
              const barWidth = Math.round((owner.avgRating / 10) * 100);
              const isExpanded = expandedOwner === owner.name;
              return (
                <div key={owner.name} className="bg-white/80 dark:bg-gray-900/80 border border-gray-200/60 dark:border-gray-800/60 rounded-2xl overflow-hidden">
                  <button onClick={() => setExpandedOwner(isExpanded ? null : owner.name)}
                    className="w-full p-5 space-y-3 text-left hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                          owner.name === "Leah" ? "bg-gradient-to-br from-pink-500 to-rose-500" : owner.name === "Chloe" ? "bg-gradient-to-br from-cyan-500 to-blue-500" : "bg-gradient-to-br from-gray-400 to-gray-500"
                        }`}>
                          {owner.name[0]}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            {owner.name}
                            <span className="text-[10px] text-indigo-500">{isExpanded ? "▼ Hide tasks" : `▶ View ${owner.taskCount} tasks`}</span>
                          </p>
                          <p className="text-[10px] text-gray-400">{owner.taskCount} tasks reviewed · {owner.feedbackCount} feedback entries</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-2xl font-bold ${scoreColor}`}>{owner.avgRating.toFixed(1)}</p>
                        <p className="text-[9px] text-gray-400">avg / 10</p>
                      </div>
                    </div>
                    {/* Score bar */}
                    <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${barWidth}%` }} />
                    </div>
                  </button>

                  {/* Drilldown: individual tasks with feedback */}
                  {isExpanded && owner.tasks.length > 0 && (
                    <div className="border-t border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                      {owner.tasks.map(({ task, avgRating, feedbacks }) => {
                        const taskScoreColor = avgRating >= 7 ? "text-green-600 dark:text-green-400" : avgRating >= 4 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
                        return (
                          <div key={task.id} className="px-5 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                            <div className="flex items-center justify-between mb-1">
                              <Link href={`/tasks/${task.id}`} className="flex-1 min-w-0 pr-3">
                                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate hover:text-indigo-500 transition-colors">{task.title}</p>
                                <p className="text-[10px] text-gray-400">{task.category}</p>
                              </Link>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className={`text-sm font-bold ${taskScoreColor}`}>{avgRating.toFixed(1)}</span>
                                <span className="text-[9px] text-gray-400">/10</span>
                              </div>
                            </div>
                            {/* Individual feedback entries */}
                            <div className="space-y-1 mt-2 pl-2 border-l-2 border-indigo-200 dark:border-indigo-800">
                              {feedbacks.map((fb) => (
                                <div key={fb.id} className="flex items-start gap-2 text-xs">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                                    fb.rating >= 7 ? "bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400" :
                                    fb.rating >= 4 ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400" :
                                    "bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                                  }`}>{fb.rating}/10</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">{fb.reviewer?.full_name}</span>
                                      <span className="text-[9px] text-gray-400">· {fmtTime(fb.created_at)}</span>
                                    </div>
                                    {fb.comment && <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{fb.comment}</p>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== GENERAL CHAT TAB ===== */}
      {activeTab === "general_chat" && (
        <div className="space-y-4 max-w-2xl">
          <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200/60 dark:border-gray-800/60">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Team Chat</h3>
              <p className="text-[10px] text-gray-400">Conversational — not tied to specific tasks. Use @ to mention team members.</p>
            </div>

            {/* Messages */}
            <div className="px-5 py-4 space-y-3 max-h-[500px] overflow-y-auto min-h-[200px]">
              {chatMessages.length === 0 ? (
                <div className="text-center py-8">
                  <HiOutlineChatAlt className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No messages yet. Start the conversation!</p>
                </div>
              ) : (() => {
                // Flat chronological order — every message renders at its actual
                // send time, even if it's a reply. Replies still show a "↳ in
                // reply to X" header above the bubble so context isn't lost.
                const byId = new Map(chatMessages.map((m) => [m.id, m]));
                const ordered = [...chatMessages].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                );

                return ordered.map((msg) => {
                  const isMe = msg.user_id === dbUser?.id;
                  const parent = msg.parent_id ? byId.get(msg.parent_id) : null;
                  return (
                    <div key={msg.id} className={`group flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${isMe ? "bg-gradient-to-br from-indigo-500 to-violet-500" : "bg-gradient-to-br from-gray-400 to-gray-500"}`}>
                        {msg.user?.full_name?.[0] || "?"}
                      </div>
                      <div className={`max-w-[75%] ${isMe ? "text-right" : ""}`}>
                        <div className="flex items-center gap-2 mb-0.5" style={{ justifyContent: isMe ? "flex-end" : "flex-start" }}>
                          <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">{msg.user?.full_name}</span>
                          <span className="text-[9px] text-gray-400">{fmtTime(msg.created_at)}</span>
                          {editingChat !== msg.id && (
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1.5">
                              <button
                                onClick={() => {
                                  setChatReplyTo({ id: msg.id, userName: msg.user?.full_name || "message", preview: msg.message.slice(0, 60) });
                                  chatInputRef.current?.focus();
                                }}
                                className="text-[9px] text-indigo-600 hover:text-indigo-500 font-medium">Reply</button>
                              {isMe && (
                                <>
                                  <button onClick={() => { setEditingChat(msg.id); setEditChatText(msg.message); }} className="text-[9px] text-gray-400 hover:text-indigo-500">Edit</button>
                                  <button onClick={() => deleteChatMsg(msg.id)} className="text-[9px] text-gray-400 hover:text-red-500">Delete</button>
                                </>
                              )}
                            </span>
                          )}
                        </div>

                        {/* Reply-to preview — keeps thread context without breaking chronological order */}
                        {parent && (
                          <div className={`flex ${isMe ? "justify-end" : "justify-start"} mb-1`}>
                            <div className="inline-flex items-start gap-1.5 max-w-full text-[10px] px-2 py-1 rounded-lg border border-indigo-200/60 dark:border-indigo-800/40 bg-indigo-50/50 dark:bg-indigo-900/15 text-left">
                              <span className="text-indigo-500 flex-shrink-0">↳</span>
                              <div className="min-w-0">
                                <span className="font-medium text-indigo-600 dark:text-indigo-400">{parent.user?.full_name || "user"}</span>
                                <span className="text-gray-500 dark:text-gray-400">: {parent.message.length > 80 ? parent.message.slice(0, 80) + "…" : parent.message}</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {editingChat === msg.id ? (
                          <div className="space-y-1">
                            <textarea value={editChatText} onChange={(e) => setEditChatText(e.target.value)} autoFocus
                              rows={Math.min(Math.max(editChatText.split("\n").length, 2), 8)}
                              wrap="soft"
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); updateChatMsg(msg.id); }
                                if (e.key === "Escape") setEditingChat(null);
                              }}
                              className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white whitespace-pre-wrap leading-relaxed resize-none break-words"
                              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }} />
                            <div className="flex gap-1.5" style={{ justifyContent: isMe ? "flex-end" : "flex-start" }}>
                              <button onClick={() => updateChatMsg(msg.id)} className="text-[9px] text-green-600 hover:text-green-500">Save</button>
                              <button onClick={() => setEditingChat(null)} className="text-[9px] text-gray-400">Cancel</button>
                              <span className="text-[9px] text-gray-400">Shift+Enter for new line</span>
                            </div>
                          </div>
                        ) : (
                          <div className={`inline-block px-3 py-2 rounded-xl text-sm text-left whitespace-pre-wrap leading-relaxed break-words ${isMe ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"}`}
                            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                            {renderMentions(msg.message)}
                          </div>
                        )}
                        {(msg.mentions?.length || 0) > 0 && (
                          <div className="flex gap-1 mt-0.5" style={{ justifyContent: isMe ? "flex-end" : "flex-start" }}>
                            {msg.mentions!.map((m, i) => (
                              <span key={i} className="text-[9px] text-indigo-500">@{(teamUsers || []).find(u => u.id === m)?.full_name || m}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div className="px-5 py-3 border-t border-gray-200/60 dark:border-gray-800/60">
              {/* Mentions dropdown — always visible when toggled */}
              {showMentions && (
                <div className="mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-1.5 max-h-80 overflow-y-auto">
                  <p className="text-[9px] text-gray-400 px-2 py-1 font-medium uppercase tracking-wider">Tag a team member</p>
                  {(teamUsers || []).map((u) => (
                    <button key={u.id} onClick={() => {
                      const atIndex = chatMsg.lastIndexOf("@");
                      if (atIndex >= 0) {
                        setChatMsg(chatMsg.slice(0, atIndex) + `@${u.full_name} `);
                      } else {
                        setChatMsg(chatMsg + `@${u.full_name} `);
                      }
                      setShowMentions(false);
                    }}
                      className="w-full text-left px-2.5 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">{u.full_name[0]}</div>
                      <div className="flex-1 min-w-0">
                        <span className="block font-medium">{u.full_name}</span>
                        <span className="text-[9px] text-gray-400">{u.email}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Replying-to context pill — visible while a reply is queued */}
              {chatReplyTo && (
                <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border-l-2 border-indigo-400">
                  <HiReply className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">Replying to {chatReplyTo.userName}</span>
                    <span className="block text-[11px] text-gray-600 dark:text-gray-400 truncate">{chatReplyTo.preview}</span>
                  </div>
                  <button onClick={() => setChatReplyTo(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex-shrink-0" title="Cancel reply">
                    <HiX className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="flex gap-2 items-end">
                <div className="relative flex-1">
                  <textarea ref={chatInputRef} value={chatMsg}
                    rows={1}
                    onChange={(e) => {
                      setChatMsg(e.target.value);
                      // Auto-grow up to ~6 lines, then scroll
                      const ta = e.target;
                      ta.style.height = "auto";
                      ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
                      const val = e.target.value;
                      // @-mention detection still works the same — looks for the last @
                      // followed by no space yet
                      const lastAt = val.lastIndexOf("@");
                      if (lastAt >= 0 && (lastAt === val.length - 1 || !val.slice(lastAt).includes(" "))) {
                        setShowMentions(true);
                      } else {
                        setShowMentions(false);
                      }
                    }}
                    onKeyDown={(e) => {
                      // Enter sends; Shift+Enter inserts a newline (Slack/Gchat convention)
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendChat();
                        // Reset textarea height after send
                        if (chatInputRef.current) chatInputRef.current.style.height = "auto";
                        return;
                      }
                      if (e.key === "Escape") {
                        if (chatReplyTo) setChatReplyTo(null);
                        else setShowMentions(false);
                      }
                    }}
                    placeholder={chatReplyTo ? `Reply to ${chatReplyTo.userName}… (Shift+Enter for new line)` : "Type a message…  (Shift+Enter for new line)"}
                    wrap="soft"
                    className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white pr-10 resize-none leading-relaxed whitespace-pre-wrap break-words"
                    style={{ overflowWrap: "anywhere", wordBreak: "break-word" }} />
                  <button onClick={() => setShowMentions(!showMentions)} className="absolute right-3 top-2.5 text-gray-400 hover:text-indigo-500 transition-colors" title="Tag someone">
                    <HiAtSymbol className="w-4 h-4" />
                  </button>
                </div>
                <button onClick={sendChat} disabled={!chatMsg.trim() || chatSending}
                  className="px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-sm rounded-xl transition-all">
                  {chatSending ? "..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== TASK FEEDBACK TAB ===== */}
      {activeTab === "task_feedback" && (
        <>
          {/* Awaiting review section — shown when filter active or for assessors */}
          {(showAwaitingReview || (isAssessor && !activeFilter && tasksWithDeliverables > 0)) && (
            <div className="bg-gradient-to-r from-violet-50 to-purple-50/50 dark:from-violet-900/10 dark:to-purple-900/5 border border-violet-200/60 dark:border-violet-800/30 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-violet-700 dark:text-violet-400 mb-3">Deliverables Needing Review</h2>
              <div className="space-y-2">
                {awaitingReviewTasks.map((t) => (
                  <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center gap-3 py-2 px-3 hover:bg-violet-100/50 dark:hover:bg-violet-900/10 rounded-xl transition-all">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[t.status] }} />
                    <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">{t.title}</span>
                    {(t.deliverables || []).some(d => isVideoUrl(d.file_url || d.file_name)) && <HiOutlineFilm className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" title="Video attached" />}
                    {(t.deliverables || []).map((d) => (
                      <span key={d.id} className={`w-3 h-3 rounded-full flex-shrink-0 ${d.viewed ? "bg-green-500" : "bg-blue-500 animate-pulse-subtle"}`} title={d.viewed ? "Viewed" : "Not yet viewed"} />
                    ))}
                    <span className="text-[10px] text-gray-400">{t.deliverables?.length} file(s)</span>
                    <HiArrowRight className="w-3 h-3 text-gray-400" />
                  </Link>
                ))}
                {awaitingReviewTasks.length === 0 && <p className="text-sm text-gray-400 text-center py-2">No tasks awaiting review</p>}
              </div>
            </div>
          )}

          {/* Feedback Threads — filtered */}
          {!showAwaitingReview && (
            <>
              {filteredThreads.length === 0 ? (
                <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-8 text-center">
                  <HiOutlineChatAlt className="w-10 h-10 text-violet-300 mx-auto mb-3" />
                  <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-1">
                    {activeFilter ? "No matching threads" : "No feedback yet"}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {activeFilter ? "Try clearing the filter to see all threads." : "Feedback from reps will appear here as threaded conversations."}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                    Feedback Threads ({filteredThreads.length}{activeFilter && activeFilter !== "all" ? ` of ${totalThreads}` : ""})
                  </h2>
                  {filteredThreads.map(({ task, feedbacks }) => {
                    const unack = feedbacks.filter((f) => !f.acknowledged && !isReplyComment(f.comment)).length;
                    // Check if last message is from the other side (= new for me)
                    const myEmail = dbUser?.email || "";
                    const iAmRep = myEmail.endsWith("@mimimomentum.com");
                    const lastFb = feedbacks[feedbacks.length - 1];
                    const lastIsRep = lastFb?.reviewer?.full_name === "Rep 1" || lastFb?.reviewer?.full_name === "Rep 2";
                    const hasNewForMe = feedbacks.length > 0 && (iAmRep ? !lastIsRep : lastIsRep);
                    return (
                      <div key={task.id} className={`bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border rounded-2xl shadow-sm overflow-hidden transition-all hover:shadow-md ${hasNewForMe ? "border-emerald-300/60 dark:border-emerald-700/40 ring-1 ring-emerald-200/50 dark:ring-emerald-800/30" : "border-gray-200/60 dark:border-gray-800/60"}`}>
                        {/* Task header — clickable card */}
                        <Link href={`/tasks/${task.id}`} className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-all">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[task.status] }} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-800 dark:text-white truncate block">{task.title}</span>
                            <span className="text-[10px] text-gray-400">{task.category} · {task.owner?.full_name || "Unassigned"}</span>
                          </div>
                          <div className="flex gap-1 items-center">
                            {(task.deliverables || []).some(d => isVideoUrl(d.file_url || d.file_name)) && <HiOutlineFilm className="w-3 h-3 text-purple-500" title="Video attached" />}
                            {(task.deliverables || []).map((d) => (
                              <span key={d.id} className={`w-2.5 h-2.5 rounded-full ${d.viewed ? "bg-green-500" : "bg-blue-500"}`} title={d.viewed ? "Viewed" : "Not viewed"} />
                            ))}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px] text-gray-400">{feedbacks.length} msgs</span>
                            {hasNewForMe && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-full font-bold animate-pulse">NEW</span>}
                            {unack > 0 && !hasNewForMe && <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 rounded-full font-semibold">{unack} unack</span>}
                            <HiArrowRight className="w-3.5 h-3.5 text-gray-400" />
                          </div>
                        </Link>

                        {/* Feedback messages — threaded (replies nest under the specific parent) */}
                        <div className="px-5 py-3 space-y-3 max-h-96 overflow-y-auto">
                          {(() => {
                            // Build parent -> children map. Children sorted ascending by created_at so
                            // a thread reads top-to-bottom in conversation order.
                            const childrenBy = new Map<string, FeedbackItem[]>();
                            const ids = new Set(feedbacks.map((f) => f.id));
                            for (const f of feedbacks) {
                              if (f.parent_id && ids.has(f.parent_id)) {
                                const arr = childrenBy.get(f.parent_id) || [];
                                arr.push(f);
                                childrenBy.set(f.parent_id, arr);
                              }
                            }
                            for (const arr of childrenBy.values()) {
                              arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                            }
                            const topLevel = feedbacks.filter((f) => !f.parent_id || !ids.has(f.parent_id));

                            const renderMsg = (fb: FeedbackItem, depth: number): React.ReactNode => {
                              const isThreaded = !!fb.parent_id;
                              const isLegacyReply = !isThreaded && isReplyComment(fb.comment);
                              const isReply = isThreaded || isLegacyReply;
                              // Strip "↩️" prefix from threaded replies — visual nesting already conveys it
                              const displayComment = isThreaded
                                ? (fb.comment || "").replace(/^↩️\s*(Reply to[^:]+:\s*)?/, "")
                                : fb.comment || "";
                              const indentClass = depth === 0
                                ? ""
                                : depth === 1
                                  ? "ml-8 pl-3 border-l-2 border-indigo-300 dark:border-indigo-600"
                                  : "ml-10 pl-3 border-l-2 border-indigo-200/60 dark:border-indigo-700/40";
                              const kids = childrenBy.get(fb.id) || [];
                              return (
                                <div key={fb.id} className={`${indentClass} ${depth > 0 ? "mt-2" : ""}`}>
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
                                      {displayComment && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">{displayComment}</p>}

                                      <div className="flex items-center gap-3 mt-1.5">
                                        {/* Doer: Acknowledge — only on top-level non-reply messages */}
                                        {isDoer && !fb.acknowledged && !isReply && (
                                          <button onClick={() => acknowledge(fb.id)} className="text-[10px] text-green-600 hover:text-green-500 flex items-center gap-0.5 transition-colors">
                                            <HiCheck className="w-3 h-3" /> Acknowledge
                                          </button>
                                        )}
                                        {/* Reply available on every message — Slack/Gchat-style threading */}
                                        <button onClick={() => setReplyTo({ taskId: task.id, fbId: fb.id })}
                                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors">
                                          <HiReply className="w-3.5 h-3.5" /> Reply
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Inline reply input renders directly under the message you clicked Reply on */}
                                  {replyTo?.fbId === fb.id && (
                                    <div className="mt-2 ml-10 space-y-1">
                                      <div className="flex gap-2">
                                        <input value={replyText} onChange={(e) => setReplyText(e.target.value)}
                                          placeholder={`Reply to ${fb.reviewer?.full_name || "message"}…`} autoFocus
                                          className="flex-1 px-3 py-1.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white"
                                          onKeyDown={(e) => e.key === "Enter" && submitReply()} />
                                        <button onClick={submitReply} className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-xs rounded-xl">Send</button>
                                        <button onClick={() => { setReplyTo(null); setReplyText(""); setReplyError(""); }} className="text-xs text-gray-400">Cancel</button>
                                      </div>
                                      {replyError && <p className="text-[10px] text-red-500">{replyError}</p>}
                                    </div>
                                  )}

                                  {/* Recurse into children (visual indent caps at depth 2) */}
                                  {kids.map((k) => renderMsg(k, Math.min(depth + 1, 2)))}
                                </div>
                              );
                            };

                            return topLevel.map((m) => renderMsg(m, 0));
                          })()}
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
            </>
          )}

          {/* ===== WEEK REPORTS SECTION ===== */}
          {(weekReports || []).length > 0 && (
            <div className="mt-6 space-y-4">
              <h2 className="text-sm font-semibold text-teal-600 dark:text-teal-400 flex items-center gap-2">
                <span className="text-base">📊</span> Week Reports ({(weekReports || []).length})
              </h2>
              <div className="space-y-4">
                {(weekReports || []).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((wr) => (
                  <div key={wr.id} className="bg-gradient-to-br from-teal-50/80 to-cyan-50/60 dark:from-teal-900/15 dark:to-cyan-900/10 border border-teal-200/60 dark:border-teal-800/30 rounded-2xl shadow-sm transition-all hover:shadow-md">
                    {/* Report header */}
                    <div className="px-5 py-3 border-b border-teal-200/40 dark:border-teal-800/20 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          wr.report_type === "wednesday"
                            ? "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400"
                            : "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400"
                        }`}>
                          {wr.report_type === "wednesday" ? "Wednesday" : "Saturday"}
                        </span>
                        <span className="text-[10px] text-gray-500">
                          by {wr.submitted_by_user?.full_name || "Unknown"} · {fmtTime(wr.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {wr.file_url && (
                          <span className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400">
                            <HiOutlinePaperClip className="w-3.5 h-3.5" /> Files
                          </span>
                        )}
                        {(wr.feedback?.length || 0) === 0 && (
                          <span className="flex items-center gap-1 text-[9px] text-amber-600 dark:text-amber-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Awaiting review
                          </span>
                        )}
                        <Link href={`/weeks/${wr.week_id}?tab=reports`} className="text-[10px] text-teal-500 hover:text-teal-400 flex items-center gap-1 transition-colors">
                          Open week <HiArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>

                    {/* Full report content — scrollable, never truncated */}
                    <div className="px-5 py-4">
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{wr.content}</p>
                    </div>

                    {/* Feedback entries */}
                    {(wr.feedback?.length || 0) > 0 && (
                      <div className="px-5 py-3 border-t border-teal-200/30 dark:border-teal-800/20 space-y-3">
                        <p className="text-[10px] text-gray-400 uppercase font-medium">Feedback ({wr.feedback!.length})</p>
                        {wr.feedback!.map((fb) => (
                          <div key={fb.id} className="flex items-start gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mt-0.5">
                              {fb.reviewer?.full_name?.[0] || "?"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{fb.reviewer?.full_name}</span>
                                <span className="text-xs font-bold text-gray-900 dark:text-white">{fb.rating}/10</span>
                                <span className="text-[9px] text-gray-400">{fmtTime(fb.created_at)}</span>
                              </div>
                              {fb.comment && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">{fb.comment}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
