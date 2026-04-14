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

  if (role !== "admin") {
    const { data: record } = await sb.from("week_report_feedback").select("reviewer_id").eq("id", id).maybeSingle();
    if (!record || record.reviewer_id !== callerId) return err("Forbidden", 403);
  }

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  const updates: Record<string, unknown> = {};
  if (body.rating !== undefined) updates.rating = body.rating;
  if (body.comment !== undefined) updates.comment = body.comment;

  const { data, error } = await sb.from("week_report_feedback").update(updates).eq("id", id).select().single();
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

  if (role !== "admin") {
    const { data: record } = await sb.from("week_report_feedback").select("reviewer_id").eq("id", id).maybeSingle();
    if (!record || record.reviewer_id !== callerId) return err("Forbidden", 403);
  }

  const { error } = await sb.from("week_report_feedback").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
