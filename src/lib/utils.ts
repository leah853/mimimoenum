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

/**
 * Encode a threaded reply with a parent message ID.
 * Format: `↩️[<parentId>] <text>` — parsed by parseReplyComment.
 * Avoids a DB migration by piggy-backing on the comment string.
 */
export function buildReplyComment(parentId: string, text: string): string {
  return `↩️[${parentId}] ${text.trim()}`;
}

/**
 * Parse a reply comment to extract the parent message ID (if encoded) and the clean text.
 * Handles three formats:
 *   1. New:    `↩️[<parentId>] <text>`              -> { parentId, text }
 *   2. Legacy: `↩️ Reply to <Author>: <text>`        -> { parentId: null, text, authorHint: 'Author' }
 *   3. Legacy: `Reply to <Author>: <text>`           -> same as #2
 * Non-replies return the original comment as text and parentId: null.
 */
export function parseReplyComment(comment?: string | null): { parentId: string | null; text: string; authorHint?: string } {
  if (!comment) return { parentId: null, text: "" };
  // Format 1: ↩️[parentId] text
  const newMatch = comment.match(/^↩️\[([^\]]+)\]\s*([\s\S]*)$/);
  if (newMatch) return { parentId: newMatch[1], text: newMatch[2] };
  // Format 2/3: legacy "Reply to <Author>: <text>" with optional emoji prefix
  const legacyMatch = comment.match(/^(?:↩️\s*)?Reply to ([^:]+):\s*([\s\S]*)$/);
  if (legacyMatch) return { parentId: null, text: legacyMatch[2], authorHint: legacyMatch[1].trim() };
  return { parentId: null, text: comment };
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
