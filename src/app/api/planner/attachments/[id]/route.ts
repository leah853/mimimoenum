import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole, getCallerId, isDoerOrAdmin } from "@/lib/api-auth";

const BUCKET = "planner_attachments";
const SIGNED_URL_TTL_SECONDS = 300;

/** `?url=1` mints a short-lived signed download URL for a file attachment. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;

  const sb = createServiceClient();
  const { data: att, error } = await sb
    .from("planner_item_attachments")
    .select("kind, storage_path, filename, content_type, link_url, text_body")
    .eq("id", id)
    .maybeSingle();
  if (error) return err(error.message, 500);
  if (!att) return err("Attachment not found", 404);
  if (att.kind !== "file" || !att.storage_path) return err("Not a file attachment", 400);

  const { data: signed, error: signErr } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(att.storage_path, SIGNED_URL_TTL_SECONDS, { download: att.filename });
  if (signErr) return err(signErr.message, 500);

  return ok({ url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
}

/** Mark a submission reviewed, so the UI can stop flagging it as pending. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const callerId = await getCallerId(request);
  const { id } = await params;

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("planner_item_attachments")
    .update({ reviewed: true, reviewed_at: new Date().toISOString(), reviewed_by: callerId })
    .eq("id", id)
    .select("id, reviewed, reviewed_at")
    .single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  if (!isDoerOrAdmin(request)) return err("Only owners can remove deliverables", 403);
  const { id } = await params;

  const sb = createServiceClient();
  const { data: att } = await sb
    .from("planner_item_attachments")
    .select("storage_path, kind")
    .eq("id", id)
    .maybeSingle();

  // Remove the row first: an orphaned storage object is harmless, a row
  // pointing at a deleted file is not.
  const { error } = await sb.from("planner_item_attachments").delete().eq("id", id);
  if (error) return err(error.message, 400);

  if (att?.kind === "file" && att.storage_path) {
    await sb.storage.from(BUCKET).remove([att.storage_path]);
  }
  return ok({ deleted: true });
}
