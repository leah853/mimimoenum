import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { isDoerOrAdmin } from "@/lib/api-auth";

/** Records a deliverable after the browser has already uploaded the file
 *  directly to Supabase storage via a signed URL. This bypasses Vercel's
 *  4.5 MB function body limit for large files. */
export async function POST(request: NextRequest) {
  if (!isDoerOrAdmin(request)) return err("Only doers can submit deliverables", 403);
  const sb = createServiceClient();

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  const { task_id, subtask_id, title, file_url, file_name, file_size_bytes, uploaded_by } = body as {
    task_id?: string; subtask_id?: string; title?: string;
    file_url?: string; file_name?: string; file_size_bytes?: number;
    uploaded_by?: string;
  };

  if (!file_url) return err("file_url required");
  if (!task_id && !subtask_id) return err("task_id or subtask_id required");

  // Auto-increment version
  const targetCol = task_id ? "task_id" : "subtask_id";
  const targetId = task_id || subtask_id;
  const { data: existing } = await sb
    .from("deliverables")
    .select("version")
    .eq(targetCol, targetId!)
    .order("version", { ascending: false })
    .limit(1);
  const version = existing && existing.length > 0 ? existing[0].version + 1 : 1;

  const { data, error } = await sb.from("deliverables").insert({
    task_id: task_id || null,
    subtask_id: subtask_id || null,
    title: title || file_name || "Deliverable",
    file_url,
    file_name: file_name || null,
    file_size_bytes: file_size_bytes || null,
    version,
    uploaded_by: uploaded_by || null,
  }).select().single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}
