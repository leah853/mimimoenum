import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate } from "@/lib/api-helpers";
import { isAssessor } from "@/lib/api-auth";

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
  const sb = createServiceClient();
  const body = await request.json();

  // Assessors can post any feedback; doers can only post replies
  const isReply = typeof body.comment === "string" && body.comment.startsWith("\u21a9\ufe0f");
  if (!isAssessor(request) && !isReply) {
    return err("Only assessors can give feedback", 403);
  }

  const missing = validate(body, ["reviewer_id", "rating", "tag"]);
  if (missing) return err(missing);

  if (!body.task_id && !body.subtask_id) {
    return err("task_id or subtask_id required");
  }

  if (body.rating < 1 || body.rating > 10) {
    return err("Rating must be between 1 and 10");
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
