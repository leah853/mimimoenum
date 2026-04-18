"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { useApi, apiPost, apiPatch, apiDelete, uploadDirect } from "@/lib/use-api";
import { canAddEOD, canGiveFeedback } from "@/lib/roles";
import type { EODUpdate } from "@/lib/types";
import { HiChevronLeft, HiChevronRight, HiOutlineFilm, HiTrash } from "react-icons/hi";
import { useToast, Skeleton } from "@/components/ui";
import { handleApiError } from "@/lib/utils";

type FullEOD = EODUpdate & {
  user?: { id: string; full_name: string };
  linked_tasks?: { task: { id: string; title: string; status: string } }[];
  comments?: { id: string; comment: string; user?: { id: string; full_name: string }; created_at: string }[];
};

type OwnerOption = { id: string; full_name: string };

export default function EODPage() {
  const { dbUser, appRole } = useAuth();
  const { toast } = useToast();
  const isDoer = canAddEOD(appRole);
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<string>(today.toISOString().split("T")[0]);

  const { data: allUpdates, loading, refetch } = useApi<FullEOD[]>("/api/eod");
  const { data: owners } = useApi<OwnerOption[]>("/api/users/owners");
  const updates = allUpdates || [];
  const isAssessor = canGiveFeedback(appRole);

  const [whatWasDone, setWhatWasDone] = useState("");
  const [whatsNext, setWhatsNext] = useState("");
  const [blockers, setBlockers] = useState("");
  const [addedBy, setAddedBy] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [editingEod, setEditingEod] = useState(false);
  const [editDone, setEditDone] = useState("");
  const [editNext, setEditNext] = useState("");
  const [editObstacles, setEditObstacles] = useState("");

  // Summary stats for current month
  const eodStats = useMemo(() => {
    const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
    const monthUpdates = updates.filter(u => u.date.startsWith(monthPrefix));
    const totalThisMonth = monthUpdates.length;
    const unreviewed = monthUpdates.filter(u => !u.comments || u.comments.length === 0).length;
    const withBlockers = monthUpdates.filter(u => !!u.blockers).length;
    // All-time: updates with no comments (for assessor banner)
    const allUnreviewed = updates.filter(u => !u.comments || u.comments.length === 0).length;
    return { totalThisMonth, unreviewed, withBlockers, allUnreviewed };
  }, [updates, viewYear, viewMonth]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const monthName = new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const todayStr = today.toISOString().split("T")[0];

  const updatesByDate = new Map<string, FullEOD>();
  updates.forEach((u) => updatesByDate.set(u.date, u));
  const selectedUpdate = updatesByDate.get(selectedDate);

  if (loading) return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="skeleton h-8 w-48" />
      <div className="flex gap-6">
        <div className="skeleton h-72 w-[380px] rounded-2xl" />
        <div className="flex-1 skeleton h-48 rounded-2xl" />
      </div>
    </div>
  );

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); };

  async function submitUpdate() {
    if (!whatWasDone || !addedBy) return;
    setSubmitting(true);
    try {
      // Upload video directly to Supabase storage (bypasses Vercel 4.5 MB limit)
      let videoUrl: string | null = null;
      if (videoFile) {
        setUploadingVideo(true);
        const res = await uploadDirect(videoFile, "eod-videos");
        videoUrl = res.url;
        setUploadingVideo(false);
      }
      await apiPost("/api/eod", {
        user_id: addedBy,
        date: selectedDate,
        what_was_done: whatWasDone,
        whats_next: whatsNext || null,
        blockers: blockers || null,
        video_url: videoUrl,
      });
      setWhatWasDone(""); setWhatsNext(""); setBlockers(""); setVideoFile(null);
      await refetch();
      toast("EOD update saved", "success");
    } catch (e) { toast(handleApiError(e), "error"); setUploadingVideo(false); }
    setSubmitting(false);
  }

  async function attachVideoToExisting(eodId: string, file: File) {
    try {
      setUploadingVideo(true);
      const res = await uploadDirect(file, "eod-videos");
      await apiPatch(`/api/eod/${eodId}`, { video_url: res.url });
      await refetch();
      toast("Video attached", "success");
    } catch (e) { toast(handleApiError(e), "error"); }
    setUploadingVideo(false);
  }

  async function removeVideoFromEod(eodId: string) {
    if (!confirm("Remove video from this update?")) return;
    try {
      await apiPatch(`/api/eod/${eodId}`, { video_url: null });
      await refetch();
      toast("Video removed", "success");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function addComment(eodId: string) {
    if (!commentText || !dbUser) return;
    try {
      await apiPost("/api/eod/comments", { eod_update_id: eodId, user_id: dbUser.id, comment: commentText });
      setCommentText("");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">EOD Updates</h1>

      {/* Summary stat pills */}
      <div className="flex gap-3 flex-wrap">
        <div className="px-4 py-2 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-xl shadow-sm flex items-center gap-2">
          <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{eodStats.totalThisMonth}</span>
          <span className="text-xs text-gray-500">updates this month</span>
        </div>
        <div className="px-4 py-2 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-yellow-200/60 dark:border-yellow-800/40 rounded-xl shadow-sm flex items-center gap-2">
          <span className="text-lg font-bold text-yellow-600 dark:text-yellow-400">{eodStats.unreviewed}</span>
          <span className="text-xs text-gray-500">unreviewed</span>
        </div>
        <div className="px-4 py-2 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-red-200/60 dark:border-red-800/40 rounded-xl shadow-sm flex items-center gap-2">
          <span className="text-lg font-bold text-red-500 dark:text-red-400">{eodStats.withBlockers}</span>
          <span className="text-xs text-gray-500">with obstacles</span>
        </div>
      </div>

      {/* Assessor (rep) alert banner */}
      {isAssessor && eodStats.allUnreviewed > 0 && (
        <div className="bg-gradient-to-r from-violet-500/10 to-indigo-500/10 dark:from-violet-600/20 dark:to-indigo-600/20 border border-violet-300/40 dark:border-violet-700/40 rounded-2xl px-5 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
            {eodStats.allUnreviewed}
          </div>
          <div>
            <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">
              {eodStats.allUnreviewed} EOD update{eodStats.allUnreviewed !== 1 ? "s" : ""} need{eodStats.allUnreviewed === 1 ? "s" : ""} your review
            </p>
            <p className="text-xs text-violet-500 dark:text-violet-400">Updates with no comments yet are awaiting your feedback.</p>
          </div>
        </div>
      )}

      <div className="flex gap-6">
        {/* Calendar */}
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-5 w-[380px] flex-shrink-0 ">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-1 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all rounded"><HiChevronLeft className="w-5 h-5 text-gray-400" /></button>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{monthName}</span>
            <button onClick={nextMonth} className="p-1 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all rounded"><HiChevronRight className="w-5 h-5 text-gray-400" /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <div key={d} className="text-center text-[10px] font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e-${i}`} className="h-10" />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const eodEntry = updatesByDate.get(dateStr);
              const hasUpdate = !!eodEntry;
              const hasComments = hasUpdate && (eodEntry.comments?.length || 0) > 0;
              const isSelected = selectedDate === dateStr;
              const isToday = dateStr === todayStr;
              // Dot color: green = reviewed (has comments), amber = needs review (no comments)
              const dotColor = hasUpdate ? (hasComments ? "bg-green-500" : "bg-amber-400 animate-pulse") : "";
              const hasVideo = hasUpdate && !!eodEntry.video_url;
              return (
                <button key={day} onClick={() => setSelectedDate(dateStr)}
                  className={`h-10 rounded-lg text-sm flex flex-col items-center justify-center transition-colors ${
                    isSelected ? "bg-gradient-to-r from-indigo-100 to-violet-100 dark:from-indigo-600/30 dark:to-violet-600/30 border border-indigo-400/50 dark:border-indigo-500/40 text-indigo-700 dark:text-white"
                    : hasUpdate && !hasComments ? "bg-amber-50/60 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400 font-medium"
                    : hasUpdate && hasComments ? "bg-green-50/60 dark:bg-green-900/10 text-green-700 dark:text-green-400"
                    : isToday ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-medium"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  }`}>
                  <span className="text-xs">{day}</span>
                  <div className="flex items-center gap-0.5 mt-0.5">
                    {hasUpdate && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />}
                    {hasVideo && <HiOutlineFilm className="w-2.5 h-2.5 text-purple-500" />}
                  </div>
                </button>
              );
            })}
          </div>
          {/* Calendar legend */}
          <div className="flex items-center gap-4 mt-3 px-1">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[9px] text-gray-400">Reviewed</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /><span className="text-[9px] text-gray-400">Needs review</span></div>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            {selectedDate === todayStr && <span className="text-xs px-2 py-0.5 bg-gradient-to-r from-indigo-100 to-violet-100 dark:from-indigo-600/20 dark:to-violet-600/20 text-indigo-600 dark:text-indigo-400 rounded-full ml-2">Today</span>}
          </h2>

          {selectedUpdate && (
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-5 space-y-3">
              {/* Header: Added by + Edit/Delete */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-[10px] font-bold">
                    {selectedUpdate.user?.full_name?.[0] || "?"}
                  </div>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Added by {selectedUpdate.user?.full_name || "Unknown"}</span>
                  <span className="text-[10px] text-gray-400">{selectedUpdate.date}</span>
                </div>
                {isDoer && !editingEod && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setEditingEod(true); setEditDone(selectedUpdate.what_was_done); setEditNext(selectedUpdate.whats_next || ""); setEditObstacles(selectedUpdate.blockers || ""); }}
                      className="text-[10px] text-indigo-500 hover:text-indigo-400 transition-colors">Edit</button>
                    <button onClick={async () => {
                      if (!confirm("Delete this EOD update?")) return;
                      try { await apiDelete(`/api/eod/${selectedUpdate.id}`); await refetch(); } catch (e) { toast(handleApiError(e), "error"); }
                    }} className="text-[10px] text-red-400 hover:text-red-500 transition-colors">Delete</button>
                  </div>
                )}
              </div>

              {editingEod ? (
                <div className="space-y-3">
                  <div><label className="text-xs text-gray-400 mb-1 block">What was done</label>
                    <textarea value={editDone} onChange={(e) => setEditDone(e.target.value)} rows={3}
                      className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" /></div>
                  <div><label className="text-xs text-gray-400 mb-1 block">What&apos;s next</label>
                    <textarea value={editNext} onChange={(e) => setEditNext(e.target.value)} rows={2}
                      className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" /></div>
                  <div><label className="text-xs text-gray-400 mb-1 block">Obstacles</label>
                    <textarea value={editObstacles} onChange={(e) => setEditObstacles(e.target.value)} rows={2}
                      className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" /></div>
                  <div className="flex gap-2">
                    <button onClick={async () => {
                      try { await apiPatch(`/api/eod/${selectedUpdate.id}`, { what_was_done: editDone, whats_next: editNext || null, blockers: editObstacles || null }); setEditingEod(false); await refetch(); } catch (e) { toast(handleApiError(e), "error"); }
                    }} className="px-3 py-1.5 bg-gradient-to-r from-green-500 to-emerald-500 hover:brightness-110 text-white text-xs rounded-xl shadow-sm transition-all">Save</button>
                    <button onClick={() => setEditingEod(false)} className="text-xs text-gray-500">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div><p className="text-xs text-gray-400 uppercase mb-1">What was done</p><p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{selectedUpdate.what_was_done}</p></div>
                  {selectedUpdate.whats_next && <div><p className="text-xs text-gray-400 uppercase mb-1">What&apos;s next</p><p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{selectedUpdate.whats_next}</p></div>}
                  {selectedUpdate.blockers && <div><p className="text-xs text-red-500 dark:text-red-400 uppercase mb-1">Obstacles</p><p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{selectedUpdate.blockers}</p></div>}
                  {/* Video preview */}
                  {selectedUpdate.video_url && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs text-purple-500 dark:text-purple-400 uppercase flex items-center gap-1">
                          <HiOutlineFilm className="w-3.5 h-3.5" /> Video Summary
                        </p>
                        {isDoer && (
                          <button onClick={() => removeVideoFromEod(selectedUpdate.id)} className="text-[10px] text-red-400 hover:text-red-500 flex items-center gap-1">
                            <HiTrash className="w-3 h-3" /> Remove
                          </button>
                        )}
                      </div>
                      <video controls preload="metadata" className="w-full rounded-lg max-h-80 bg-black">
                        <source src={selectedUpdate.video_url} />
                        Your browser does not support video playback.
                      </video>
                    </div>
                  )}
                  {/* Attach video to existing update */}
                  {!selectedUpdate.video_url && isDoer && (
                    <div>
                      <label className="text-xs text-purple-500 dark:text-purple-400 mb-1 flex items-center gap-1 cursor-pointer">
                        <HiOutlineFilm className="w-3.5 h-3.5" /> Attach 1-Min Video Summary
                      </label>
                      <input type="file" accept="video/*" onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) attachVideoToExisting(selectedUpdate.id, f);
                      }}
                        disabled={uploadingVideo}
                        className="text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-purple-100 dark:file:bg-purple-900/30 file:text-purple-700 dark:file:text-purple-300" />
                      {uploadingVideo && <p className="text-[10px] text-purple-500 mt-1">Uploading...</p>}
                    </div>
                  )}
                </>
              )}

              {/* Feedback & Conversation Thread */}
              <div className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Feedback & Replies ({selectedUpdate.comments?.length || 0})
                  </h4>
                  {(selectedUpdate.comments?.length || 0) === 0 && (
                    <span className="text-[9px] px-2 py-0.5 bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-full">Awaiting review</span>
                  )}
                </div>

                {(selectedUpdate.comments?.length || 0) > 0 ? (
                  <div className="space-y-2.5">
                    {(selectedUpdate.comments || []).map((c) => {
                      const isRep = c.user?.full_name === "Rep 1" || c.user?.full_name === "Rep 2";
                      return (
                        <div key={c.id} className={`flex gap-2.5 ${isRep ? "" : "flex-row-reverse"}`}>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${
                            isRep ? "bg-gradient-to-br from-violet-500 to-purple-500" : "bg-gradient-to-br from-indigo-500 to-blue-500"
                          }`}>
                            {c.user?.full_name?.[0] || "?"}
                          </div>
                          <div className={`max-w-[80%] ${isRep ? "" : "text-right"}`}>
                            <div className="flex items-center gap-2 mb-0.5" style={{ justifyContent: isRep ? "flex-start" : "flex-end" }}>
                              <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">{c.user?.full_name}</span>
                              <span className="text-[9px] text-gray-400">{new Date(c.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                            </div>
                            <div className={`inline-block px-3 py-2 rounded-xl text-sm ${
                              isRep ? "bg-violet-50 dark:bg-violet-900/20 text-violet-800 dark:text-violet-300 border border-violet-200/40 dark:border-violet-800/30"
                                : "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-300 border border-indigo-200/40 dark:border-indigo-800/30"
                            }`}>
                              {c.comment}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">No feedback yet. {isAssessor ? "Add your review below." : "Waiting for rep review."}</p>
                )}

                {/* Reply input — visible to both doers and reps */}
                <div className="flex gap-2 pt-1">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                    {dbUser?.full_name?.[0] || "?"}
                  </div>
                  <input value={commentText} onChange={(e) => setCommentText(e.target.value)}
                    placeholder={isAssessor ? "Add your feedback..." : "Reply to feedback..."}
                    className="flex-1 px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white"
                    onKeyDown={(e) => e.key === "Enter" && addComment(selectedUpdate.id)} />
                  <button onClick={() => addComment(selectedUpdate.id)} disabled={!commentText.trim()}
                    className="px-3 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-xs rounded-xl transition-all">
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}

          {!selectedUpdate && isDoer && (
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-5 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Add Update</h3>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Added By *</label>
                <select value={addedBy} onChange={(e) => setAddedBy(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white">
                  <option value="">Select who&apos;s adding...</option>
                  {(owners || []).map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">What was done? *</label>
                <textarea value={whatWasDone} onChange={(e) => setWhatWasDone(e.target.value)} rows={3}
                  className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">What&apos;s next?</label>
                <textarea value={whatsNext} onChange={(e) => setWhatsNext(e.target.value)} rows={2}
                  className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Obstacles</label>
                <textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} rows={2}
                  className="w-full px-3 py-2 bg-gray-50/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <HiOutlineFilm className="w-3.5 h-3.5 text-purple-500" /> 1-Min Video Summary (Optional)
                </label>
                <input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                  className="text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-purple-100 dark:file:bg-purple-900/30 file:text-purple-700 dark:file:text-purple-300" />
                {videoFile && (
                  <div className="flex items-center gap-2 mt-1">
                    <HiOutlineFilm className="w-3 h-3 text-purple-500" />
                    <span className="text-[10px] text-gray-500 truncate">{videoFile.name}</span>
                    <span className="text-[9px] text-gray-400">({(videoFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                    <button onClick={() => setVideoFile(null)} className="text-gray-400 hover:text-red-500"><HiTrash className="w-3 h-3" /></button>
                  </div>
                )}
              </div>
              <button onClick={submitUpdate} disabled={!whatWasDone || !addedBy || submitting || uploadingVideo}
                className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-sm rounded-xl shadow-md transition-all active:scale-[0.97]">
                {uploadingVideo ? "Uploading video..." : submitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          )}
          {!selectedUpdate && !isDoer && (
            <div className="bg-violet-50 dark:bg-violet-900/10 border border-violet-200/60 dark:border-violet-800/30 rounded-xl px-4 py-3 text-xs text-violet-700 dark:text-violet-400">
              👁️ Reps can view EOD updates but cannot add or edit them.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
