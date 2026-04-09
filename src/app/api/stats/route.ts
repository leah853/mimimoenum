import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

/** Lightweight counts for sidebar badge — avoids fetching all tasks with relations */
export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const sb = createServiceClient();

  // Count unacknowledged feedback (excluding replies)
  const { count: unacknowledged, error: e1 } = await sb
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .or("acknowledged.is.null,acknowledged.eq.false")
    .not("comment", "like", "↩️%");

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

  if (e1 || e2) return err((e1 || e2)!.message, 500);

  return ok({
    unacknowledged: unacknowledged || 0,
    awaitingReview,
    feedbackCount: (unacknowledged || 0) + awaitingReview,
  });
}
