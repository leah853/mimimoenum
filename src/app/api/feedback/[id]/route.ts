import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;
  const sb = createServiceClient();

  // Ownership check: only the reviewer or admin can edit
  if (role !== "admin") {
    const callerId = await getCallerId(request);
    if (!callerId) return err("Could not verify identity", 401);
    const { data: record } = await sb.from("feedback").select("reviewer_id").eq("id", id).single();
    if (!record || record.reviewer_id !== callerId) {
      return err("Forbidden: you can only edit your own feedback", 403);
    }
  }

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  // If acknowledging, set timestamp
  if (body.acknowledged === true && !body.acknowledged_at) {
    body.acknowledged_at = new Date().toISOString();
  }

  const { data, error } = await sb.from("feedback").update(body).eq("id", id).select().single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;
  const sb = createServiceClient();

  // Ownership check: only the reviewer or admin can delete
  if (role !== "admin") {
    const callerId = await getCallerId(request);
    if (!callerId) return err("Could not verify identity", 401);
    const { data: record } = await sb.from("feedback").select("reviewer_id").eq("id", id).single();
    if (!record || record.reviewer_id !== callerId) {
      return err("Forbidden: you can only delete your own feedback", 403);
    }
  }

  const { error } = await sb.from("feedback").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
