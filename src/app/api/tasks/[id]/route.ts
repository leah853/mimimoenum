import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createServiceClient();

  const { data, error } = await sb
    .from("tasks")
    .select(`
      *,
      owner:users!tasks_owner_id_fkey(id, full_name, email),
      subtasks(*, owner:users!subtasks_owner_id_fkey(id, full_name)),
      deliverables(id, title, file_url, file_name, version, created_at),
      feedback(*, reviewer:users!feedback_reviewer_id_fkey(id, full_name)),
      deps_from:dependencies!dependencies_task_id_fkey(
        depends_on_task_id,
        depends_on:tasks!dependencies_depends_on_task_id_fkey(id, title, status)
      ),
      deps_to:dependencies!dependencies_depends_on_task_id_fkey(
        task_id,
        task:tasks!dependencies_task_id_fkey(id, title, status)
      )
    `)
    .eq("id", id)
    .single();

  if (error) return err(error.message, 404);
  return ok(data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;
  const sb = createServiceClient();

  // Ownership check: only the task owner or admin can edit
  if (role !== "admin") {
    const callerId = await getCallerId(request);
    const { data: record } = await sb.from("tasks").select("owner_id").eq("id", id).single();
    if (!record || record.owner_id !== callerId) {
      return err("Forbidden: you can only edit your own tasks", 403);
    }
  }

  const body = await request.json();

  // Business rule: if trying to complete, check deliverables + feedback
  if (body.status === "completed") {
    const { data: deliverables } = await sb.from("deliverables").select("id").eq("task_id", id).limit(1);
    if (!deliverables || deliverables.length === 0) {
      return err("Cannot complete task without at least one deliverable", 422);
    }
    const { data: feedback } = await sb.from("feedback").select("id").eq("task_id", id).limit(1);
    if (!feedback || feedback.length === 0) {
      return err("Cannot complete task without feedback", 422);
    }
  }

  const { data, error } = await sb.from("tasks").update(body).eq("id", id).select().single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (role !== "admin") return err("Only admins can delete tasks", 403);
  const { id } = await params;
  const sb = createServiceClient();
  const { error } = await sb.from("tasks").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
