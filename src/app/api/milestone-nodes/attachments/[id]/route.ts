import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

const BUCKET = "milestone_attachments";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);
  const { id } = await params;

  const sb = createServiceClient();
  const { data: att } = await sb
    .from("milestone_node_attachments")
    .select("owner_id, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!att) return err("Attachment not found", 404);

  // Only the uploader or an admin can delete.
  if (att.owner_id !== callerId && role !== "admin") {
    return err("Only the uploader or an admin can delete this file", 403);
  }

  const { error: storageErr } = await sb.storage.from(BUCKET).remove([att.storage_path]);
  if (storageErr) return err(storageErr.message, 500);

  const { error: dbErr } = await sb.from("milestone_node_attachments").delete().eq("id", id);
  if (dbErr) return err(dbErr.message, 500);

  return ok({ deleted: true });
}
