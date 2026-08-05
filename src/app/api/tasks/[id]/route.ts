import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";
import { resolveWeekId } from "@/lib/task-week";

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
    if (!callerId) return err("Could not verify identity", 401);
    const { data: record } = await sb.from("tasks").select("owner_id").eq("id", id).single();
    if (!record || record.owner_id !== callerId) {
      return err("Forbidden: you can only edit your own tasks", 403);
    }
  }

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  // If the deadline moved into a different iteration window, auto-reassign
  // iteration_id (unless caller set it explicitly). Week is then derived from
  // (iteration, deadline) via resolveWeekId — the invariant is that every task
  // lives inside one of its iteration's weeks.
  if (body.deadline && typeof body.deadline === "string" && body.iteration_id === undefined) {
    const { data: iter } = await sb
      .from("iterations")
      .select("id")
      .lte("start_date", body.deadline)
      .gte("end_date", body.deadline)
      .maybeSingle();
    if (iter?.id) body.iteration_id = iter.id;
  }

  // Recompute week_id when the caller changed iteration or deadline (and did
  // NOT pass week_id explicitly). If iteration_id itself is changing, the old
  // week_id belongs to a different iteration and MUST be replaced — pull the
  // effective deadline (from the patch or the existing row) to resolve.
  const iterChanging = body.iteration_id !== undefined;
  const deadlineChanging = body.deadline !== undefined;
  if (body.week_id === undefined && (iterChanging || deadlineChanging)) {
    let effectiveIter: string | null | undefined = body.iteration_id;
    let effectiveDeadline: string | null | undefined = body.deadline;
    if (effectiveIter === undefined || effectiveDeadline === undefined) {
      const { data: existing } = await sb
        .from("tasks")
        .select("iteration_id, deadline")
        .eq("id", id)
        .single();
      if (effectiveIter === undefined) effectiveIter = existing?.iteration_id ?? null;
      if (effectiveDeadline === undefined) effectiveDeadline = existing?.deadline ?? null;
    }
    if (effectiveIter) {
      const resolved = await resolveWeekId(sb, effectiveIter, effectiveDeadline);
      if (resolved) body.week_id = resolved;
    }
  }

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
