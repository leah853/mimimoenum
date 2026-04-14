import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const sb = createServiceClient();
  const weekId = new URL(request.url).searchParams.get("week_id");

  let query = sb
    .from("week_reports")
    .select("*, submitted_by_user:users!week_reports_submitted_by_fkey(id, full_name), feedback:week_report_feedback(id, reviewer_id, rating, comment, created_at, reviewer:users!week_report_feedback_reviewer_id_fkey(id, full_name))");

  if (weekId) query = query.eq("week_id", weekId);

  const { data, error } = await query;
  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const sb = createServiceClient();
  const formData = await request.formData();

  const weekId = formData.get("week_id") as string;
  const reportType = formData.get("report_type") as string;
  const content = formData.get("content") as string;
  const submittedBy = formData.get("submitted_by") as string;
  const existingUrls = formData.get("existing_file_urls") as string | null;

  if (!weekId || !reportType || !content || !submittedBy) {
    return err("Missing required fields: week_id, report_type, content, submitted_by");
  }

  // Collect all files from formData (supports multiple)
  const files = formData.getAll("files") as File[];
  const fileUrls: string[] = existingUrls ? JSON.parse(existingUrls) : [];

  for (const file of files) {
    if (!file.name || file.size === 0) continue;
    const ext = file.name.split(".").pop();
    const path = `reports/${weekId}/${reportType}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await sb.storage.from("deliverables").upload(path, file);
    if (upErr) return err(`Upload failed: ${upErr.message}`, 500);
    const { data: { publicUrl } } = sb.storage.from("deliverables").getPublicUrl(path);
    fileUrls.push(publicUrl);
  }

  // Also handle legacy single "file" field for backward compatibility
  const singleFile = formData.get("file") as File | null;
  if (singleFile && singleFile.name && singleFile.size > 0) {
    const ext = singleFile.name.split(".").pop();
    const path = `reports/${weekId}/${reportType}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await sb.storage.from("deliverables").upload(path, singleFile);
    if (upErr) return err(`Upload failed: ${upErr.message}`, 500);
    const { data: { publicUrl } } = sb.storage.from("deliverables").getPublicUrl(path);
    fileUrls.push(publicUrl);
  }

  // Store file URLs as JSON array string in file_url column
  const fileUrlValue = fileUrls.length > 0 ? JSON.stringify(fileUrls) : null;

  const { data, error } = await sb.from("week_reports").upsert({
    week_id: weekId,
    report_type: reportType,
    content,
    file_url: fileUrlValue,
    submitted_by: submittedBy,
  }, { onConflict: "week_id,report_type" }).select().single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}
