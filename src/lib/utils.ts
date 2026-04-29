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
