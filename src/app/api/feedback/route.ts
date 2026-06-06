import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";
import { isReplyComment } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const sb = createServiceClient();
  const taskId = new URL(request.url).searchParams.get("task_id");

  let query = sb
    .from("feedback")
    .select("*, reviewer:users!feedback_reviewer_id_fkey(id, full_name, email)")
    .order("created_at", { ascending: false });

  if (taskId) query = query.eq("task_id", taskId);

  const { data, error } = await query;
  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest) {
  const callerRole = getCallerRole(request);
  if (!callerRole) return err("Not authenticated", 401);

  const sb = createServiceClient();
  let body;
  try { body = await request.json(); } catch { return err("Invalid JSON", 400); }

  // A message is a reply if either parent_id is set OR the legacy "↩️" prefix
  // is present. Doers/admins can reply; only assessors can post new feedback.
  const isReply = Boolean(body.parent_id) || isReplyComment(body.comment);
  if (callerRole !== "assessor" && !isReply) {
    return err("Only assessors can give feedback", 403);
  }

  const missing = validate(body, ["reviewer_id", "rating", "tag"]);
  if (missing) return err(missing);

  if (!body.task_id && !body.subtask_id) {
    return err("task_id or subtask_id required");
  }

  if (typeof body.rating !== "number" || isNaN(body.rating) || body.rating < 1 || body.rating > 10) {
    return err("Rating must be a number between 1 and 10");
  }

  if (!["approved", "needs_improvement", "blocked"].includes(body.tag)) {
    return err("Tag must be approved, needs_improvement, or blocked");
  }

  // If parent_id is set, validate that the parent feedback exists and belongs
  // to the same task — prevents cross-task replies and broken trees.
  if (body.parent_id) {
    const { data: parent } = await sb.from("feedback").select("id, task_id, subtask_id").eq("id", body.parent_id).maybeSingle();
    if (!parent) return err("Parent feedback not found", 404);
    if (body.task_id && parent.task_id && parent.task_id !== body.task_id) return err("Parent belongs to a different task", 422);
    if (body.subtask_id && parent.subtask_id && parent.subtask_id !== body.subtask_id) return err("Parent belongs to a different subtask", 422);
  }

  const insertPayload = {
    task_id: body.task_id || null,
    subtask_id: body.subtask_id || null,
    reviewer_id: body.reviewer_id,
    rating: body.rating,
    comment: body.comment ?? null,
    tag: body.tag,
    parent_id: body.parent_id || null,
  };

  const { data, error } = await sb
    .from("feedback")
    .insert(insertPayload)
    .select("*, reviewer:users!feedback_reviewer_id_fkey(id, full_name)")
    .single();

  if (error) return err(error.message, 400);

  // The moment a rep scores a task (a non-reply piece of feedback from an
  // assessor), mark the task completed. Replies, doer-acks, and feedback on
  // subtasks don't trigger this. Per-task: a single fresh rating is enough.
  if (!isReply && callerRole === "assessor" && body.task_id) {
    const { error: updErr } = await sb
      .from("tasks")
      .update({ status: "completed" })
      .eq("id", body.task_id);
    // Don't fail the request if this side-effect errors — feedback is still saved.
    if (updErr) console.warn("[feedback] auto-complete failed:", updErr.message);
  }

  return ok(data, 201);
}
