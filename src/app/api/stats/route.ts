import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";
import { isReplyComment } from "@/lib/utils";

/** Lightweight counts for sidebar badge — avoids fetching all tasks with relations */
export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const sb = createServiceClient();

  // Fetch all unacknowledged feedback then filter replies in JS for robustness
  const { data: unackRows, error: e1 } = await sb
    .from("feedback")
    .select("id, comment")
    .or("acknowledged.is.null,acknowledged.eq.false");

  const unacknowledged = (unackRows || []).filter((f: { id: string; comment: string | null }) => !isReplyComment(f.comment)).length;

  // Count tasks with deliverables but no feedback (awaiting review)
  const { data: tasksWithDeliverables, error: e2 } = await sb
    .from("deliverables")
    .select("task_id")
    .not("task_id", "is", null);

  const deliverableTaskIds = [...new Set((tasksWithDeliverables || []).map((d: { task_id: string }) => d.task_id))];

  let awaitingReview = 0;
  if (deliverableTaskIds.length > 0) {
    // Check which of these tasks have zero feedback
    const { data: tasksWithFeedback } = await sb
      .from("feedback")
      .select("task_id")
      .in("task_id", deliverableTaskIds);

    const feedbackTaskIds = new Set((tasksWithFeedback || []).map((f: { task_id: string }) => f.task_id));
    awaitingReview = deliverableTaskIds.filter(id => !feedbackTaskIds.has(id)).length;
  }

  // EOD stats: count updates from last 7 days with zero comments (needs review)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

  const { data: recentEods, error: e3 } = await sb
    .from("eod_updates")
    .select("id, eod_comments(id)")
    .gte("date", sevenDaysAgoStr);

  const eodNeedsReview = (recentEods || []).filter(
    (e: { id: string; eod_comments: { id: string }[] }) => !e.eod_comments || e.eod_comments.length === 0
  ).length;

  if (e1 || e2 || e3) return err((e1 || e2 || e3)!.message, 500);

  return ok({
    unacknowledged,
    awaitingReview,
    feedbackCount: unacknowledged + awaitingReview,
    eodNeedsReview,
  });
}
