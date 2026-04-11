"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApi, apiPost, apiPatch, apiUpload } from "@/lib/use-api";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";
import type { Task, TaskStatus } from "@/lib/types";
import { HiArrowLeft, HiOutlineChatAlt, HiPlus, HiCheck, HiOutlinePaperClip, HiTrash } from "react-icons/hi";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui";
import Link from "next/link";
import { calcScore, formatDate, handleApiError } from "@/lib/utils";

type FullTask = Task & { owner?: { id: string; full_name: string }; subtasks?: { id: string }[]; deliverables?: { id: string }[]; feedback?: { id: string }[] };
type UserOption = { id: string; full_name: string };
type WeekOption = { id: string; week_number: number; start_date: string; end_date: string };
type IterOption = { id: string; name: string; start_date: string; end_date: string; weeks?: WeekOption[] };
type QuarterOption = { id: string; name: string; iterations: IterOption[] };
type WeekReport = { id: string; report_type: string; content: string; file_url?: string; feedback?: { id: string; rating: number; comment?: string; reviewer?: { full_name: string } }[] };

const CATEGORIES = ["Customer Success & PG Acquisition", "Product / Engineering / Workflows", "Cybersecurity", "Continuous Learning", "Talent Acquisition", "Branding"];

/** Parse file_url which could be a single URL string or a JSON array of URLs */
function parseFileUrls(fileUrl?: string | null): string[] {
  if (!fileUrl) return [];
  try {
    const parsed = JSON.parse(fileUrl);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  // Legacy single URL
  return [fileUrl];
}

export default function WeekDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { dbUser } = useAuth();
  const { toast } = useToast();
  const isInvestor = dbUser?.role === "mimimomentum" || dbUser?.role === "admin";

  const { data: allTasks, refetch } = useApi<FullTask[]>(id ? `/api/tasks?week_id=${id}` : null);
  const { data: quarters } = useApi<QuarterOption[]>("/api/quarters");
  const { data: users } = useApi<UserOption[]>("/api/users/owners");
  const { data: reports, refetch: refetchReports } = useApi<WeekReport[]>(id ? `/api/week-reports?week_id=${id}` : null);

  const [activeTab, setActiveTab] = useState<"tasks" | "reports">("tasks");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [wedReport, setWedReport] = useState("");
  const [satReport, setSatReport] = useState("");
  const [wedFiles, setWedFiles] = useState<File[]>([]);
  const [satFiles, setSatFiles] = useState<File[]>([]);
  const [fbTarget, setFbTarget] = useState<string | null>(null);
  const [fbRating, setFbRating] = useState(5);
  const [fbComment, setFbComment] = useState("");

  const tasks = allTasks || [];
  const allUsers = users || [];

  // Find week info from quarters
  let week: WeekOption | undefined;
  let iteration: IterOption | undefined;
  if (quarters?.[0]) {
    for (const iter of quarters[0].iterations) {
      const w = (iter.weeks || []).find((w) => w.id === id);
      if (w) { week = w; iteration = iter; break; }
    }
  }

  const weekScore = calcScore(tasks);
  const completed = tasks.filter((t) => t.status === "completed").length;
  const wedReportData = (reports || []).find((r) => r.report_type === "wednesday");
  const satReportData = (reports || []).find((r) => r.report_type === "saturday");

  async function updateStatus(taskId: string, status: string) {
    try { await apiPatch(`/api/tasks/${taskId}`, { status }); await refetch(); }
    catch (e) { toast(handleApiError(e), "error"); }
  }

  async function addTask(category: string) {
    if (!newTitle.trim() || !allUsers[0]) return;
    try {
      await apiPost("/api/tasks", {
        title: newTitle.trim(), category, owner_id: allUsers[0].id,
        deadline: week?.end_date || "2026-07-04",
        quarter_id: quarters?.[0]?.id || null, iteration_id: iteration?.id || null, week_id: id,
        status: "not_started",
      });
      setNewTitle(""); setAddingTo(null); await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function submitReport(type: "wednesday" | "saturday") {
    const content = type === "wednesday" ? wedReport : satReport;
    const files = type === "wednesday" ? wedFiles : satFiles;
    if (!content || !dbUser) return;
    const fd = new FormData();
    fd.append("week_id", id);
    fd.append("report_type", type);
    fd.append("content", content);
    fd.append("submitted_by", dbUser.id);
    for (const f of files) {
      fd.append("files", f);
    }
    try {
      await apiUpload("/api/week-reports", fd);
      if (type === "wednesday") { setWedReport(""); setWedFiles([]); }
      else { setSatReport(""); setSatFiles([]); }
      await refetchReports();
      toast("Report submitted", "success");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function addFilesToReport(type: "wednesday" | "saturday", existingReport: WeekReport, newFiles: File[]) {
    if (!dbUser || newFiles.length === 0) return;
    const existingUrls = parseFileUrls(existingReport.file_url);
    const fd = new FormData();
    fd.append("week_id", id);
    fd.append("report_type", type);
    fd.append("content", existingReport.content);
    fd.append("submitted_by", dbUser.id);
    fd.append("existing_file_urls", JSON.stringify(existingUrls));
    for (const f of newFiles) {
      fd.append("files", f);
    }
    try {
      await apiUpload("/api/week-reports", fd);
      await refetchReports();
      toast(`${newFiles.length} file(s) added`, "success");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function submitFeedback() {
    if (!fbTarget || !dbUser) return;
    try {
      await apiPost("/api/week-reports/feedback", { week_report_id: fbTarget, reviewer_id: dbUser.id, rating: fbRating, comment: fbComment || null });
      setFbTarget(null); setFbComment(""); setFbRating(5);
      await refetchReports();
      toast("Feedback submitted", "success");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
        <HiArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{iteration?.name || "Iteration"} — Week {week?.week_number || "?"}</h1>
          {week && <p className="text-sm text-gray-500">{formatDate(week.start_date)} — {formatDate(week.end_date)}</p>}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{weekScore.toFixed(1)}<span className="text-sm text-gray-400">/10</span></div>
          <p className="text-xs text-gray-500">Week Score</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-3">
        {([
          { label: "Total", value: tasks.length, cls: "text-gray-900 dark:text-white" },
          { label: "Done", value: completed, cls: "text-green-600 dark:text-green-400" },
          { label: "In Progress", value: tasks.filter((t) => t.status === "in_progress").length, cls: "text-blue-600 dark:text-blue-400" },
          { label: "Not Started", value: tasks.filter((t) => t.status === "not_started").length, cls: "text-gray-500" },
          { label: "Obstacle", value: tasks.filter((t) => t.status === "blocked").length, cls: "text-red-600 dark:text-red-400" },
        ]).map((k) => (
          <div key={k.label} className="bg-white/80 dark:bg-gray-900/80 border border-gray-200/60 dark:border-gray-800/60 rounded-xl p-3 text-center">
            <p className={`text-xl font-bold ${k.cls}`}>{k.value}</p>
            <p className="text-[10px] text-gray-400 uppercase">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {(["tasks", "reports"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${activeTab === tab ? "border-blue-500 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500"}`}>
            {tab === "tasks" ? "Project Plan" : "Wed / Sat Reports"}
          </button>
        ))}
      </div>

      {/* TASKS TAB */}
      {activeTab === "tasks" && (
        <div className="space-y-4">
          {CATEGORIES.map((cat) => {
            const ct = tasks.filter((t) => t.category === cat);
            return (
              <div key={cat} className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm overflow-x-auto">
                <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/20">
                  <span className="text-sm font-semibold text-gray-800 dark:text-white">{cat}</span>
                  <span className="text-xs text-gray-400">{ct.length}</span>
                </div>
                {ct.length > 0 && (
                  <div className="grid grid-cols-[minmax(220px,1fr)_100px_100px_90px_40px] gap-0 px-4 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800/30">
                    <span>Task</span><span>Owner</span><span>Status</span><span>Due</span><span></span>
                  </div>
                )}
                {ct.map((task) => (
                  <div key={task.id} className="grid grid-cols-[minmax(220px,1fr)_100px_100px_90px_40px] gap-0 px-4 py-2 border-b border-gray-100/50 dark:border-gray-800/15 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-all duration-200 group items-center">
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[task.status] }} />
                      <Link href={`/tasks/${task.id}`} className="text-sm text-gray-700 dark:text-gray-200 hover:text-blue-500 truncate">{task.title}</Link>
                    </div>
                    <span className="text-[11px] text-gray-500 truncate">{task.owner?.full_name || "—"}</span>
                    <select value={task.status} onChange={(e) => updateStatus(task.id, e.target.value)}
                      className="text-[11px] font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer appearance-none"
                      style={{ backgroundColor: STATUS_COLORS[task.status] + "20", color: STATUS_COLORS[task.status] }}>
                      {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k} className="bg-white dark:bg-gray-900">{l}</option>)}
                    </select>
                    <span className="text-[11px] text-gray-500">{task.deadline || "—"}</span>
                    <Link href={`/tasks/${task.id}`} className="text-[10px] text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100">Open</Link>
                  </div>
                ))}
                {ct.length === 0 && addingTo !== cat && <p className="text-xs text-gray-400 px-4 py-3 italic">No tasks yet</p>}
                {addingTo === cat ? (
                  <div className="flex items-center gap-2 px-4 py-2">
                    <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New task..." autoFocus
                      className="flex-1 px-2 py-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-sm text-gray-900 dark:text-white"
                      onKeyDown={(e) => { if (e.key === "Enter") addTask(cat); if (e.key === "Escape") { setAddingTo(null); setNewTitle(""); } }} />
                    <button onClick={() => addTask(cat)} className="text-green-500"><HiCheck className="w-4 h-4" /></button>
                    <button onClick={() => { setAddingTo(null); setNewTitle(""); }} className="text-xs text-gray-400">✕</button>
                  </div>
                ) : (
                  <button onClick={() => { setAddingTo(cat); setNewTitle(""); }}
                    className="flex items-center gap-1.5 px-4 py-2 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-all duration-200 w-full text-left">
                    <HiPlus className="w-3 h-3" /> Add task
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* REPORTS TAB */}
      {activeTab === "reports" && (
        <div className="space-y-6">
          <ReportSection title="Wednesday Mid-Week Report" type="wednesday"
            reportData={wedReportData} report={wedReport} setReport={setWedReport}
            files={wedFiles} setFiles={setWedFiles} onSubmit={() => submitReport("wednesday")}
            onAddFiles={(newFiles) => wedReportData && addFilesToReport("wednesday", wedReportData, newFiles)}
            isInvestor={isInvestor} onRate={(rid) => setFbTarget(rid)} />
          <ReportSection title="Saturday End-of-Week Report" type="saturday"
            reportData={satReportData} report={satReport} setReport={setSatReport}
            files={satFiles} setFiles={setSatFiles} onSubmit={() => submitReport("saturday")}
            onAddFiles={(newFiles) => satReportData && addFilesToReport("saturday", satReportData, newFiles)}
            isInvestor={isInvestor} onRate={(rid) => setFbTarget(rid)} />

          {fbTarget && (
            <div className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
              <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/60 dark:border-gray-700/60 rounded-2xl p-6 shadow-2xl w-full max-w-md space-y-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">Rate Report</h3>
                <div><label className="text-xs text-gray-500 mb-1 block">Rating (1-10)</label>
                  <input type="number" min={1} max={10} value={fbRating} onChange={(e) => setFbRating(parseInt(e.target.value))}
                    className="w-24 px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white" /></div>
                <textarea value={fbComment} onChange={(e) => setFbComment(e.target.value)} rows={3} placeholder="Comment..."
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white" />
                <div className="flex gap-3 justify-end">
                  <button onClick={() => setFbTarget(null)} className="px-4 py-2 text-sm text-gray-500">Cancel</button>
                  <button onClick={submitFeedback} className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 text-white text-sm rounded-xl shadow-md transition-all active:scale-[0.97]">Submit</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReportSection({ title, type, reportData, report, setReport, files, setFiles, onSubmit, onAddFiles, isInvestor, onRate }: {
  title: string; type: string; reportData?: WeekReport; report: string; setReport: (v: string) => void;
  files: File[]; setFiles: (f: File[]) => void; onSubmit: () => void; onAddFiles: (files: File[]) => void;
  isInvestor: boolean; onRate: (rid: string) => void;
}) {
  const [addingMore, setAddingMore] = useState(false);
  const [moreFiles, setMoreFiles] = useState<File[]>([]);
  const existingUrls = parseFileUrls(reportData?.file_url);

  return (
    <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">{title}</h3>
        {reportData && <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full">Submitted</span>}
      </div>
      {reportData ? (
        <>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{reportData.content}</p>

          {/* Attachments list */}
          {existingUrls.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-400 uppercase font-medium">Attachments ({existingUrls.length})</p>
              {existingUrls.map((url, i) => {
                const filename = url.split("/").pop()?.split("?")[0] || `File ${i + 1}`;
                return (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-blue-500 hover:text-blue-400 transition-colors py-1">
                    <HiOutlinePaperClip className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{decodeURIComponent(filename)}</span>
                  </a>
                );
              })}
            </div>
          )}

          {/* Add more files to existing report */}
          {!isInvestor && (
            addingMore ? (
              <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <p className="text-[10px] text-gray-400">Add more attachments</p>
                <input type="file" multiple onChange={(e) => setMoreFiles(Array.from(e.target.files || []))}
                  className="text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-gray-100 dark:file:bg-gray-800" />
                {moreFiles.length > 0 && (
                  <div className="space-y-1">
                    {moreFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                        <HiOutlinePaperClip className="w-3 h-3" />
                        <span className="truncate">{f.name}</span>
                        <span className="text-[9px] text-gray-400">({(f.size / 1024).toFixed(0)} KB)</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => { onAddFiles(moreFiles); setMoreFiles([]); setAddingMore(false); }}
                    disabled={moreFiles.length === 0}
                    className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-xs rounded-lg transition-all">
                    Upload {moreFiles.length} file(s)
                  </button>
                  <button onClick={() => { setAddingMore(false); setMoreFiles([]); }} className="text-xs text-gray-400">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAddingMore(true)}
                className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-400 transition-colors pt-1">
                <HiPlus className="w-3 h-3" /> Add attachments
              </button>
            )
          )}

          {/* Feedback */}
          {(reportData.feedback?.length || 0) > 0 && (
            <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              {reportData.feedback!.map((fb) => (
                <div key={fb.id} className="bg-gray-50/80 dark:bg-gray-800/40 rounded-xl px-3 py-2">
                  <div className="flex justify-between"><span className="text-xs text-gray-600 dark:text-gray-300">{fb.reviewer?.full_name}</span><span className="text-xs font-bold">{fb.rating}/10</span></div>
                  {fb.comment && <p className="text-xs text-gray-500 mt-1">{fb.comment}</p>}
                </div>
              ))}
            </div>
          )}
          {isInvestor && <button onClick={() => onRate(reportData.id)} className="text-xs text-blue-500 flex items-center gap-1"><HiOutlineChatAlt className="w-3 h-3" /> Rate</button>}
        </>
      ) : (
        <div className="space-y-3">
          <textarea value={report} onChange={(e) => setReport(e.target.value)} rows={3} placeholder="Write report..."
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white" />

          {/* Multiple file selector */}
          <div className="space-y-2">
            <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-gray-100 dark:file:bg-gray-800" />
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <HiOutlinePaperClip className="w-3 h-3" />
                    <span className="truncate">{f.name}</span>
                    <span className="text-[9px] text-gray-400">({(f.size / 1024).toFixed(0)} KB)</span>
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">
                      <HiTrash className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={onSubmit} disabled={!report}
            className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-xs rounded-lg transition-all">
            Submit{files.length > 0 ? ` with ${files.length} file(s)` : ""}
          </button>
        </div>
      )}
    </div>
  );
}
