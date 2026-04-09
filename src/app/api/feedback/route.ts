import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate } from "@/lib/api-helpers";
import { isAssessor, getCallerRole } from "@/lib/api-auth";
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

  // Any authenticated user can reply; only assessors can post new feedback
  const isReply = isReplyComment(body.comment);
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

  const { data, error } = await sb
    .from("feedback")
    .insert(body)
    .select("*, reviewer:users!feedback_reviewer_id_fkey(id, full_name)")
    .single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}
