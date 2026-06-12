// Shared utility functions — eliminates duplication across pages

import type { TaskStatus } from "@/lib/types";

/** Format a date string (YYYY-MM-DD) to "Apr 6" style */
export function formatDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Format a timestamp to "Apr 6, 2:30 PM" style */
export function formatTime(d: string): string {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Calculate score (0-10) from task completion ratio */
export function calcScore(tasks: { status: TaskStatus }[]): number {
  if (!tasks.length) return 0;
  return (tasks.filter((t) => t.status === "completed").length / tasks.length) * 10;
}

/** Check if a feedback comment is a reply (not original feedback) */
export function isReplyComment(comment?: string | null): boolean {
  return !!comment && (comment.startsWith("↩️") || comment.startsWith("\u21a9\ufe0f") || comment.startsWith("Reply to"));
}

/** Extract a human-readable error message from an unknown catch value */
export function handleApiError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "An unexpected error occurred";
}

/** Detect if a file URL or filename points to a video (mp4, mov, webm, m4v, avi) */
export function isVideoUrl(urlOrName?: string | null): boolean {
  if (!urlOrName) return false;
  const s = urlOrName.toLowerCase().split("?")[0];
  return /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(s);
}

/** A task is "awaiting review" when the doer has uploaded a deliverable but
 *  no feedback exists yet — the ball is in the rep's court even if the
 *  underlying status is still in_progress/not_started. Treated the same as
 *  under_review for overdue/due-today purposes. */
function isAwaitingReview(task: {
  status: TaskStatus;
  deliverables?: { id: string }[] | null;
  feedback?: { id: string }[] | null;
}): boolean {
  if (task.status === "under_review") return true;
  if (task.status === "completed") return false;
  const hasDeliverables = (task.deliverables?.length || 0) > 0;
  const hasFeedback = (task.feedback?.length || 0) > 0;
  return hasDeliverables && !hasFeedback;
}

/** Tasks already handed off to reps (under_review, OR with deliverables
 *  awaiting first review) are NOT overdue from the doer's perspective — the
 *  ball is in the rep's court. They show as "Needs Review" instead.
 *  Completed tasks are obviously not overdue. */
export function isTaskOverdue(
  task: {
    deadline?: string | null;
    status: TaskStatus;
    deliverables?: { id: string }[] | null;
    feedback?: { id: string }[] | null;
  },
  todayISO?: string,
): boolean {
  if (!task.deadline) return false;
  if (task.status === "completed") return false;
  if (isAwaitingReview(task)) return false;
  const today = todayISO || new Date().toISOString().split("T")[0];
  return task.deadline < today;
}

/** Due-today excludes under_review and awaiting-review for the same reason. */
export function isTaskDueToday(
  task: {
    deadline?: string | null;
    status: TaskStatus;
    deliverables?: { id: string }[] | null;
    feedback?: { id: string }[] | null;
  },
  todayISO?: string,
): boolean {
  if (!task.deadline) return false;
  if (task.status === "completed") return false;
  if (isAwaitingReview(task)) return false;
  const today = todayISO || new Date().toISOString().split("T")[0];
  return task.deadline === today;
}
