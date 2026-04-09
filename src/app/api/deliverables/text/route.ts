import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { isDoerOrAdmin } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  if (!isDoerOrAdmin(request)) return err("Only doers can submit deliverables", 403);
  const sb = createServiceClient();
  const body = await request.json();

  const { task_id, subtask_id, title, description, uploaded_by } = body;
  if (!title) return err("Title is required");
  if (!task_id && !subtask_id) return err("task_id or subtask_id required");

  // Auto-increment version
  const targetCol = task_id ? "task_id" : "subtask_id";
  const targetId = task_id || subtask_id;

  const { data: existing } = await sb
    .from("deliverables")
    .select("version")
    .eq(targetCol, targetId)
    .order("version", { ascending: false })
    .limit(1);

  const version = existing && existing.length > 0 ? existing[0].version + 1 : 1;

  const { data, error } = await sb.from("deliverables").insert({
    task_id: task_id || null,
    subtask_id: subtask_id || null,
    title: description ? `${title} — ${description}` : title,
    file_url: "text-only://no-attachment",
    file_name: null,
    version,
    uploaded_by: uploaded_by || null,
  }).select().single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}
