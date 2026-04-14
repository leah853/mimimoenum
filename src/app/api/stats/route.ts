import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";
import { isReplyComment } from "@/lib/utils";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";
import { detectRole } from "@/lib/roles";

/** Lightweight counts for sidebar badge */
export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  // Determine caller's side (doer or assessor)
  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  const session = cookie ? decodeSession(decodeURIComponent(cookie.value)) : null;
  const callerRole = session ? detectRole(session.email) : role;
  const callerIsRep = callerRole === "assessor";

  const sb = createServiceClient();

  // Fetch all unacknowledged feedback then filter replies in JS
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
    const { data: tasksWithFeedback } = await sb
      .from("feedback")
      .select("task_id")
      .in("task_id", deliverableTaskIds);

    const feedbackTaskIds = new Set((tasksWithFeedback || []).map((f: { task_id: string }) => f.task_id));
    awaitingReview = deliverableTaskIds.filter(id => !feedbackTaskIds.has(id)).length;
  }

  // EOD stats: updates from last 7 days with zero comments
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

  // New messages: count threads where the last message is from the OTHER side
  // Fetch all feedback grouped by task with reviewer email
  const { data: allFeedback } = await sb
    .from("feedback")
    .select("task_id, created_at, reviewer:users!feedback_reviewer_id_fkey(email)")
    .order("created_at", { ascending: false });

  let newMessages = 0;
  if (allFeedback && allFeedback.length > 0) {
    // Group by task_id, find the latest message per task
    const latestByTask = new Map<string, { email: string }>();
    for (const fb of allFeedback as { task_id: string; created_at: string; reviewer: { email: string } | null }[]) {
      if (!fb.task_id || latestByTask.has(fb.task_id)) continue;
      if (fb.reviewer?.email) latestByTask.set(fb.task_id, { email: fb.reviewer.email });
    }

    for (const [, latest] of latestByTask) {
      const lastSenderIsRep = latest.email.endsWith("@mimimomentum.com");
      // If I'm a rep and last message is from a doer → new for me
      // If I'm a doer and last message is from a rep → new for me
      if (callerIsRep && !lastSenderIsRep) newMessages++;
      if (!callerIsRep && lastSenderIsRep) newMessages++;
    }
  }

  if (e1 || e2 || e3) return err((e1 || e2 || e3)!.message, 500);

  return ok({
    unacknowledged,
    awaitingReview,
    feedbackCount: unacknowledged + awaitingReview + newMessages,
    eodNeedsReview,
    newMessages,
  });
}
