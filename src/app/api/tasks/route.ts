import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate } from "@/lib/api-helpers";
import { isDoerOrAdmin, getCallerRole } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const sb = createServiceClient();
  const { searchParams } = new URL(request.url);

  let query = sb
    .from("tasks")
    .select(`
      *,
      owner:users!tasks_owner_id_fkey(id, full_name, email),
      subtasks(*),
      deliverables(id, title, file_url, version, created_at),
      feedback(id, rating, tag, comment, acknowledged, acknowledged_by, acknowledged_at, parent_id, created_at, reviewer:users!feedback_reviewer_id_fkey(id, full_name)),
      deps_from:dependencies!dependencies_task_id_fkey(depends_on_task_id),
      deps_to:dependencies!dependencies_depends_on_task_id_fkey(task_id)
    `)
    .order("created_at", { ascending: false });

  const quarterId = searchParams.get("quarter_id");
  const iterationId = searchParams.get("iteration_id");
  const weekId = searchParams.get("week_id");
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const ownerId = searchParams.get("owner_id");

  if (quarterId) query = query.eq("quarter_id", quarterId);
  if (iterationId) query = query.eq("iteration_id", iterationId);
  if (weekId) query = query.eq("week_id", weekId);
  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  if (ownerId) query = query.eq("owner_id", ownerId);

  const { data, error } = await query;
  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest) {
  if (!isDoerOrAdmin(request)) return err("Only doers can create tasks", 403);

  const sb = createServiceClient();
  const body = await request.json();

  const missing = validate(body, ["title", "owner_id", "deadline"]);
  if (missing) return err(missing);

  const { data, error } = await sb.from("tasks").insert(body).select().single();
  if (error) return err(error.message, 400);
  return ok(data, 201);
}
