import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { isDoerOrAdmin, getCallerRole, getCallerId } from "@/lib/api-auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isDoerOrAdmin(request)) return err("Only doers can edit EOD updates", 403);
  const role = getCallerRole(request);
  const { id } = await params;
  const sb = createServiceClient();

  // Ownership check: only the author or admin can edit
  if (role !== "admin") {
    const callerId = await getCallerId(request);
    if (!callerId) return err("Could not verify identity", 401);
    const { data: record } = await sb.from("eod_updates").select("user_id").eq("id", id).single();
    if (!record || record.user_id !== callerId) {
      return err("Forbidden: you can only edit your own EOD updates", 403);
    }
  }

  const body = await request.json();

  const { data, error } = await sb.from("eod_updates").update(body).eq("id", id).select().single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isDoerOrAdmin(request)) return err("Only doers can delete EOD updates", 403);
  const role = getCallerRole(request);
  const { id } = await params;
  const sb = createServiceClient();

  // Ownership check: only the author or admin can delete
  if (role !== "admin") {
    const callerId = await getCallerId(request);
    if (!callerId) return err("Could not verify identity", 401);
    const { data: record } = await sb.from("eod_updates").select("user_id").eq("id", id).single();
    if (!record || record.user_id !== callerId) {
      return err("Forbidden: you can only delete your own EOD updates", 403);
    }
  }

  // Delete linked tasks and comments first
  await sb.from("eod_update_tasks").delete().eq("eod_update_id", id);
  await sb.from("eod_comments").delete().eq("eod_update_id", id);
  const { error } = await sb.from("eod_updates").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
