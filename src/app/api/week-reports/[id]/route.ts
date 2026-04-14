import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;
  const sb = createServiceClient();

  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);

  // Ownership check
  if (role !== "admin") {
    const { data: record } = await sb.from("week_reports").select("submitted_by").eq("id", id).single();
    if (!record || record.submitted_by !== callerId) return err("Forbidden", 403);
  }

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  const { data, error } = await sb.from("week_reports").update({ content: body.content }).eq("id", id).select().single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;
  const sb = createServiceClient();

  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);

  // Ownership check
  if (role !== "admin") {
    const { data: record } = await sb.from("week_reports").select("submitted_by").eq("id", id).single();
    if (!record || record.submitted_by !== callerId) return err("Forbidden", 403);
  }

  // Delete feedback first (cascade should handle but be safe)
  await sb.from("week_report_feedback").delete().eq("week_report_id", id);
  const { error } = await sb.from("week_reports").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
