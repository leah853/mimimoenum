import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { isDoerOrAdmin } from "@/lib/api-auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isDoerOrAdmin(request)) return err("Only doers can edit EOD updates", 403);
  const { id } = await params;
  const sb = createServiceClient();
  const body = await request.json();

  const { data, error } = await sb.from("eod_updates").update(body).eq("id", id).select().single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isDoerOrAdmin(request)) return err("Only doers can delete EOD updates", 403);
  const { id } = await params;
  const sb = createServiceClient();

  // Delete linked tasks and comments first
  await sb.from("eod_update_tasks").delete().eq("eod_update_id", id);
  await sb.from("eod_comments").delete().eq("eod_update_id", id);
  const { error } = await sb.from("eod_updates").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
