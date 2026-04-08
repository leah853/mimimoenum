import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const sb = createServiceClient();
  const taskId = new URL(request.url).searchParams.get("task_id");

  let query = sb.from("deliverables").select("*").order("version", { ascending: false });
  if (taskId) query = query.eq("task_id", taskId);

  const { data, error } = await query;
  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest) {
  const sb = createServiceClient();
  const formData = await request.formData();

  const file = formData.get("file") as File;
  const taskId = formData.get("task_id") as string;
  const subtaskId = formData.get("subtask_id") as string;
  const title = formData.get("title") as string;
  const uploadedBy = formData.get("uploaded_by") as string;

  if (!file) return err("No file provided");
  if (!taskId && !subtaskId) return err("task_id or subtask_id required");

  // Upload to storage
  const ext = file.name.split(".").pop();
  const path = `deliverables/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await sb.storage.from("deliverables").upload(path, file);
  if (uploadError) return err(`Upload failed: ${uploadError.message}`, 500);

  const { data: { publicUrl } } = sb.storage.from("deliverables").getPublicUrl(path);

  // Auto-increment version
  const targetCol = taskId ? "task_id" : "subtask_id";
  const targetId = taskId || subtaskId;

  const { data: existing } = await sb
    .from("deliverables")
    .select("version")
    .eq(targetCol, targetId)
    .order("version", { ascending: false })
    .limit(1);

  const version = existing && existing.length > 0 ? existing[0].version + 1 : 1;

  const { data, error } = await sb.from("deliverables").insert({
    task_id: taskId || null,
    subtask_id: subtaskId || null,
    title: title || file.name,
    file_url: publicUrl,
    file_name: file.name,
    file_size_bytes: file.size,
    version,
    uploaded_by: uploadedBy || null,
  }).select().single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}
