"use client";

import { useApi, apiPatch, apiPost, apiDelete, invalidateCache } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { canGiveFeedback, canEditTasks } from "@/lib/roles";
import type { Task, Feedback, Deliverable } from "@/lib/types";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import Link from "next/link";
import { useState, useRef, useEffect, useMemo } from "react";
import { HiOutlineChatAlt, HiOutlinePaperClip, HiArrowRight, HiCheck, HiReply, HiEye, HiX, HiAtSymbol } from "react-icons/hi";
import { useToast, Skeleton, SkeletonRows } from "@/components/ui";
import { handleApiError, isReplyComment } from "@/lib/utils";

type FeedbackItem = Feedback & { reviewer?: { id: string; full_name: string }; acknowledged?: boolean; acknowledged_by?: string; acknowledged_at?: string };
type FullTask = Task & {
  feedback?: FeedbackItem[];
  deliverables?: (Deliverable & { viewed?: boolean; viewed_at?: string })[];
  owner?: { id: string; full_name: string };
};

type FilterType = "all" | "unacknowledged" | "unviewed" | "awaiting_review" | null;

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
  const [activeTab, setActiveTab] = useState<"task_feedback" | "general_chat">("task_feedback");

  // General Chat state
  const [chatMsg, setChatMsg] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [editingChat, setEditingChat] = useState<string | null>(null);
  const [editChatText, setEditChatText] = useState("");
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
  const { totalThreads, totalFeedback, unacknowledged, awaitingReviewTasks, tasksWithDeliverables, unviewedDeliverables } = useMemo(() => {
    const totalThreads = threads.length;
    const taskFeedbackCount = threads.reduce((s, t) => s + t.feedbacks.filter((f) => !isReplyComment(f.comment)).length, 0);
    const wrList = weekReports || [];
    const weekReportFeedbackCount = wrList.reduce((s, wr) => s + (wr.feedback?.length || 0), 0);
    const totalFeedback = taskFeedbackCount + weekReportFeedbackCount;
    const unacknowledged = threads.reduce((s, t) => s + t.feedbacks.filter((f) => !f.acknowledged && !isReplyComment(f.comment)).length, 0);
    const awaitingReviewTasks = all.filter((t) => (t.deliverables?.length || 0) > 0 && !(t.feedback?.length));
    const weekReportsAwaitingReview = wrList.filter((wr) => !(wr.feedback?.length));
    const tasksWithDeliverables = awaitingReviewTasks.length + weekReportsAwaitingReview.length;
    const unviewedDeliverables = all.reduce((s, t) => s + (t.deliverables || []).filter((d) => !d.viewed).length, 0);
    return { totalThreads, totalFeedback, unacknowledged, awaitingReviewTasks, tasksWithDeliverables, unviewedDeliverables };
  }, [threads, all, weekReports]);

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
    if (activeFilter === "unviewed") {
      return threads.filter(t => (t.task.deliverables || []).some(d => !d.viewed));
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
    if (!replyTo || !replyText || !dbUser) return;
    setReplyError("");
    try {
      const orig = threads.find((t) => t.task.id === replyTo.taskId)?.feedbacks.find((f) => f.id === replyTo.fbId);
      await apiPost("/api/feedback", {
        task_id: replyTo.taskId, reviewer_id: dbUser.id, rating: orig?.rating || 5,
        comment: `↩️ Reply to ${orig?.reviewer?.full_name}: ${replyText}`, tag: "approved",
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
    if (!chatMsg.trim() || !dbUser) return;
    setChatSending(true);
    try {
      const mentions = extractMentionIds(chatMsg);
      await apiPost("/api/chat", { user_id: dbUser.id, message: chatMsg, mentions });
      setChatMsg("");
      setShowMentions(false);
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
        <button onClick={() => toggleFilter("unviewed")}
          className={`text-left rounded-2xl p-4 interactive transition-all ${
            activeFilter === "unviewed"
              ? "bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-blue-900/20 dark:to-cyan-900/15 border-2 border-blue-400 dark:border-blue-600 ring-1 ring-blue-400"
              : "bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-blue-200/60 dark:border-blue-800/30 bg-gradient-to-br from-blue-50 to-cyan-50/50 dark:from-blue-900/10 dark:to-cyan-900/5"
          }`}>
          <p className="text-xs text-blue-600 dark:text-blue-400">Unviewed Files</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{unviewedDeliverables}</p>
          {activeFilter === "unviewed" && <p className="text-[9px] text-blue-500 mt-1">Filter active</p>}
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
            {activeFilter === "unacknowledged" ? "Unacknowledged feedback" : activeFilter === "unviewed" ? "Unviewed files" : "Awaiting review"}
          </span>
          <button onClick={() => setActiveFilter(null)} className="text-gray-400 hover:text-gray-600 transition-colors"><HiX className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Tabs: Task Feedback / General Chat */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        <button onClick={() => setActiveTab("task_feedback")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${activeTab === "task_feedback" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          Task Feedback
        </button>
        <button onClick={() => setActiveTab("general_chat")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-all ${activeTab === "general_chat" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          General Chat
        </button>
      </div>

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
              ) : chatMessages.map((msg) => {
                const isMe = msg.user_id === dbUser?.id;
                return (
                  <div key={msg.id} className={`group flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${isMe ? "bg-gradient-to-br from-indigo-500 to-violet-500" : "bg-gradient-to-br from-gray-400 to-gray-500"}`}>
                      {msg.user?.full_name?.[0] || "?"}
                    </div>
                    <div className={`max-w-[75%] ${isMe ? "text-right" : ""}`}>
                      <div className="flex items-center gap-2 mb-0.5" style={{ justifyContent: isMe ? "flex-end" : "flex-start" }}>
                        <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">{msg.user?.full_name}</span>
                        <span className="text-[9px] text-gray-400">{fmtTime(msg.created_at)}</span>
                        {isMe && editingChat !== msg.id && (
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1.5">
                            <button onClick={() => { setEditingChat(msg.id); setEditChatText(msg.message); }} className="text-[9px] text-gray-400 hover:text-indigo-500">Edit</button>
                            <button onClick={() => deleteChatMsg(msg.id)} className="text-[9px] text-gray-400 hover:text-red-500">Delete</button>
                          </span>
                        )}
                      </div>
                      {editingChat === msg.id ? (
                        <div className="space-y-1">
                          <input value={editChatText} onChange={(e) => setEditChatText(e.target.value)} autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") updateChatMsg(msg.id); if (e.key === "Escape") setEditingChat(null); }}
                            className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" />
                          <div className="flex gap-1.5" style={{ justifyContent: isMe ? "flex-end" : "flex-start" }}>
                            <button onClick={() => updateChatMsg(msg.id)} className="text-[9px] text-green-600 hover:text-green-500">Save</button>
                            <button onClick={() => setEditingChat(null)} className="text-[9px] text-gray-400">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className={`inline-block px-3 py-2 rounded-xl text-sm text-left ${isMe ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"}`}>
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
              })}
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
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input value={chatMsg}
                    onChange={(e) => {
                      setChatMsg(e.target.value);
                      const val = e.target.value;
                      const lastAt = val.lastIndexOf("@");
                      if (lastAt >= 0 && (lastAt === val.length - 1 || !val.slice(lastAt).includes(" "))) {
                        setShowMentions(true);
                      } else {
                        setShowMentions(false);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
                      if (e.key === "Escape") setShowMentions(false);
                    }}
                    placeholder="Type a message..."
                    className="w-full px-4 py-2.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white pr-10" />
                  <button onClick={() => setShowMentions(!showMentions)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-500 transition-colors" title="Tag someone">
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
                              <span key={d.id} className={`w-2.5 h-2.5 rounded-full ${d.viewed ? "bg-green-500" : "bg-blue-500"}`} title={d.viewed ? "Viewed" : "Not viewed"} />
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
                            const isReply = isReplyComment(fb.comment);
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
                                  <div className="mt-2 ml-10 space-y-1">
                                    <div className="flex gap-2">
                                      <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Reply..." autoFocus
                                        className="flex-1 px-3 py-1.5 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white"
                                        onKeyDown={(e) => e.key === "Enter" && submitReply()} />
                                      <button onClick={submitReply} className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-xs rounded-xl">Send</button>
                                      <button onClick={() => { setReplyTo(null); setReplyText(""); setReplyError(""); }} className="text-xs text-gray-400">Cancel</button>
                                    </div>
                                    {replyError && <p className="text-[10px] text-red-500">{replyError}</p>}
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
            </>
          )}

          {/* ===== WEEK REPORTS SECTION ===== */}
          {(weekReports || []).length > 0 && (
            <div className="mt-6 space-y-4">
              <h2 className="text-sm font-semibold text-teal-600 dark:text-teal-400 flex items-center gap-2">
                <span className="text-base">📊</span> Week Reports
              </h2>
              <div className="space-y-3">
                {(weekReports || []).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((wr) => (
                  <div key={wr.id} className="bg-gradient-to-br from-teal-50/80 to-cyan-50/60 dark:from-teal-900/15 dark:to-cyan-900/10 border border-teal-200/60 dark:border-teal-800/30 rounded-2xl shadow-sm overflow-hidden transition-all hover:shadow-md">
                    {/* Report header */}
                    <div className="flex items-center gap-3 px-5 py-3 border-b border-teal-200/40 dark:border-teal-800/20">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        wr.report_type === "wednesday"
                          ? "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400"
                          : "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400"
                      }`}>
                        {wr.report_type === "wednesday" ? "Wednesday" : "Saturday"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-gray-700 dark:text-gray-300 truncate block">{wr.content}</span>
                        <span className="text-[10px] text-gray-400">
                          Submitted by {wr.submitted_by_user?.full_name || "Unknown"} · {fmtTime(wr.created_at)}
                        </span>
                      </div>
                      {wr.file_url && (
                        <a href={wr.file_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400 hover:text-teal-500 transition-colors">
                          <HiOutlinePaperClip className="w-3.5 h-3.5" /> File
                        </a>
                      )}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-gray-400">{wr.feedback?.length || 0} feedback</span>
                      </div>
                    </div>

                    {/* Feedback entries */}
                    <div className="px-5 py-3 space-y-3">
                      {(wr.feedback?.length || 0) > 0 ? (
                        wr.feedback!.map((fb) => (
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
                        ))
                      ) : (
                        <div className="flex items-center gap-2 py-1">
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                          <span className="text-xs text-amber-600 dark:text-amber-400">Awaiting review</span>
                        </div>
                      )}
                    </div>
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
