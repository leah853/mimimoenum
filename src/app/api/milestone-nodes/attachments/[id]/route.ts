import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

const BUCKET = "milestone_attachments";

/** Mark a submission as reviewed (or un-reviewed).
 *
 *  Marking as reviewed requires the parent node to have BOTH:
 *    - a score (1-10) set on the node
 *    - at least one feedback message
 *  Otherwise 422. Un-reviewing has no gate.
 *
 *  This encodes the workflow: a submission is only "reviewed" when a reviewer
 *  has scored the work and left a written note. Prevents accidental
 *  green-lighting of items nobody's actually assessed.
 */
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

  if (body.reviewed) {
    // Look up the parent node to check score + feedback exist.
    const { data: att, error: attErr } = await sb
      .from("milestone_node_attachments")
      .select("node_id")
      .eq("id", id)
      .maybeSingle();
    if (attErr) return err(attErr.message, 500);
    if (!att) return err("Submission not found", 404);

    const [{ data: node }, { count: fbCount, error: fbErr }] = await Promise.all([
      sb.from("milestone_nodes").select("score").eq("id", att.node_id).maybeSingle(),
      sb.from("milestone_node_feedback").select("id", { count: "exact", head: true }).eq("node_id", att.node_id),
    ]);
    if (fbErr) return err(fbErr.message, 500);
    if (!node) return err("Parent node not found", 404);
    if (node.score == null) {
      return err("Cannot mark reviewed until this task has a score (1-10)", 422);
    }
    if ((fbCount || 0) === 0) {
      return err("Cannot mark reviewed until this task has at least one feedback message", 422);
    }
  }

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
