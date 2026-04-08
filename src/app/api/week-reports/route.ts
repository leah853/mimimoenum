import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const sb = createServiceClient();
  const weekId = new URL(request.url).searchParams.get("week_id");

  let query = sb
    .from("week_reports")
    .select("*, submitted_by_user:users!week_reports_submitted_by_fkey(id, full_name), feedback:week_report_feedback(*, reviewer:users!week_report_feedback_reviewer_id_fkey(id, full_name))");

  if (weekId) query = query.eq("week_id", weekId);

  const { data, error } = await query;
  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest) {
  const sb = createServiceClient();
  const formData = await request.formData();

  const weekId = formData.get("week_id") as string;
  const reportType = formData.get("report_type") as string;
  const content = formData.get("content") as string;
  const submittedBy = formData.get("submitted_by") as string;
  const file = formData.get("file") as File | null;

  if (!weekId || !reportType || !content || !submittedBy) {
    return err("Missing required fields: week_id, report_type, content, submitted_by");
  }

  let fileUrl: string | null = null;
  if (file) {
    const ext = file.name.split(".").pop();
    const path = `reports/${weekId}/${reportType}-${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from("deliverables").upload(path, file);
    if (upErr) return err(`Upload failed: ${upErr.message}`, 500);
    const { data: { publicUrl } } = sb.storage.from("deliverables").getPublicUrl(path);
    fileUrl = publicUrl;
  }

  const { data, error } = await sb.from("week_reports").upsert({
    week_id: weekId,
    report_type: reportType,
    content,
    file_url: fileUrl,
    submitted_by: submittedBy,
  }, { onConflict: "week_id,report_type" }).select().single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}
