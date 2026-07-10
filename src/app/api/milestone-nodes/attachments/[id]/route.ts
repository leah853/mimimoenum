import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

const BUCKET = "milestone_attachments";

/** Mark a submission as reviewed (or un-reviewed). Any authenticated user can
 *  do this — the "reviewed" flag is about "someone's looked at it" not about
 *  authorship. Wire this to a "Mark reviewed" button in the UI. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);
  const { id } = await params;

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);
  if (typeof body.reviewed !== "boolean") return err("reviewed (boolean) required");

  const sb = createServiceClient();
  const patch: Record<string, unknown> = { reviewed: body.reviewed };
  if (body.reviewed) {
    patch.reviewed_at = new Date().toISOString();
    patch.reviewed_by = callerId;
  } else {
    patch.reviewed_at = null;
    patch.reviewed_by = null;
  }

  const { data, error } = await sb
    .from("milestone_node_attachments")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);
  const { id } = await params;

  const sb = createServiceClient();
  const { data: att } = await sb
    .from("milestone_node_attachments")
    .select("owner_id, storage_path, kind")
    .eq("id", id)
    .maybeSingle();
  if (!att) return err("Attachment not found", 404);

  // Only the uploader or an admin can delete.
  if (att.owner_id !== callerId && role !== "admin") {
    return err("Only the uploader or an admin can delete this submission", 403);
  }

  // Only the file kind has a storage object to clean up.
  if (att.kind === "file" && att.storage_path) {
    const { error: storageErr } = await sb.storage.from(BUCKET).remove([att.storage_path]);
    if (storageErr) return err(storageErr.message, 500);
  }

  const { error: dbErr } = await sb.from("milestone_node_attachments").delete().eq("id", id);
  if (dbErr) return err(dbErr.message, 500);

  return ok({ deleted: true });
}
