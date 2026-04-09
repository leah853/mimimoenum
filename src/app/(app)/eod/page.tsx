"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useApi, apiPost, apiPatch, apiDelete } from "@/lib/use-api";
import { canAddEOD } from "@/lib/roles";
import type { EODUpdate } from "@/lib/types";
import { HiChevronLeft, HiChevronRight } from "react-icons/hi";
import { useToast } from "@/components/ui";
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

  const { data: allUpdates, refetch } = useApi<FullEOD[]>("/api/eod");
  const { data: owners } = useApi<OwnerOption[]>("/api/users/owners");
  const updates = allUpdates || [];

  const [whatWasDone, setWhatWasDone] = useState("");
  const [whatsNext, setWhatsNext] = useState("");
  const [blockers, setBlockers] = useState("");
  const [addedBy, setAddedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [editingEod, setEditingEod] = useState(false);
  const [editDone, setEditDone] = useState("");
  const [editNext, setEditNext] = useState("");
  const [editObstacles, setEditObstacles] = useState("");

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const monthName = new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const todayStr = today.toISOString().split("T")[0];

  const updatesByDate = new Map<string, FullEOD>();
  updates.forEach((u) => updatesByDate.set(u.date, u));
  const selectedUpdate = updatesByDate.get(selectedDate);

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); } else setViewMonth(viewMonth - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); } else setViewMonth(viewMonth + 1); };

  async function submitUpdate() {
    if (!whatWasDone || !addedBy) return;
    setSubmitting(true);
    try {
      await apiPost("/api/eod", {
        user_id: addedBy,
        date: selectedDate,
        what_was_done: whatWasDone,
        whats_next: whatsNext || null,
        blockers: blockers || null,
      });
      setWhatWasDone(""); setWhatsNext(""); setBlockers("");
      await refetch();
      toast("EOD update saved", "success");
    } catch (e) { toast(handleApiError(e), "error"); }
    setSubmitting(false);
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
              const hasUpdate = updatesByDate.has(dateStr);
              const isSelected = selectedDate === dateStr;
              const isToday = dateStr === todayStr;
              return (
                <button key={day} onClick={() => setSelectedDate(dateStr)}
                  className={`h-10 rounded-lg text-sm flex flex-col items-center justify-center transition-colors ${
                    isSelected ? "bg-gradient-to-r from-indigo-100 to-violet-100 dark:from-indigo-600/30 dark:to-violet-600/30 border border-indigo-400/50 dark:border-indigo-500/40 text-indigo-700 dark:text-white"
                    : isToday ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-medium"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  }`}>
                  <span className="text-xs">{day}</span>
                  {hasUpdate && <span className="w-1 h-1 rounded-full bg-green-500 mt-0.5" />}
                </button>
              );
            })}
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
                </>
              )}

              {/* Comments */}
              {(selectedUpdate.comments?.length || 0) > 0 && (
                <div className="border-t border-gray-200 dark:border-gray-800 pt-2 space-y-1">
                  {selectedUpdate.comments!.map((c) => (
                    <div key={c.id} className="text-xs"><span className="font-medium text-gray-600 dark:text-gray-300">{c.user?.full_name}:</span> <span className="text-gray-500">{c.comment}</span></div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add comment..."
                  className="flex-1 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white"
                  onKeyDown={(e) => e.key === "Enter" && addComment(selectedUpdate.id)} />
                <button onClick={() => addComment(selectedUpdate.id)} className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 rounded-lg">Reply</button>
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
              <button onClick={submitUpdate} disabled={!whatWasDone || !addedBy || submitting}
                className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-sm rounded-xl shadow-md transition-all active:scale-[0.97]">
                {submitting ? "Submitting..." : "Submit"}
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
