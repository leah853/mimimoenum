import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";

const BUCKET = "milestone_attachments";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("milestone_node_attachments")
    .select("id, filename, content_type, size_bytes, uploaded_by, uploaded_at")
    .eq("node_id", id)
    .order("uploaded_at", { ascending: false });
  if (error) return err(error.message, 500);
  return ok(data);
}

/** Step 1 of upload — client asks for a signed upload URL, then PUTs the file
 *  directly to Supabase Storage. Bypasses the 4.5 MB Vercel serverless body
 *  cap and keeps large files off our lambda. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);
  const { id: nodeId } = await params;

  const body = await safeJson(request);
  if (!body || !body.filename) return err("filename required");
  const filename: string = body.filename;
  const contentType: string | undefined = body.content_type;
  const sizeBytes: number | undefined = typeof body.size_bytes === "number" ? body.size_bytes : undefined;

  const sb = createServiceClient();

  // Verify the node exists so we don't create orphaned uploads.
  const { data: node } = await sb.from("milestone_nodes").select("id").eq("id", nodeId).maybeSingle();
  if (!node) return err("Node not found", 404);

  // Path scheme: milestone_nodes/<node_id>/<timestamp>-<rand>-<safe-basename>
  const safeBase = filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80);
  const storagePath = `milestone_nodes/${nodeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;

  const { data: signed, error: signErr } = await sb.storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (signErr) return err(signErr.message, 500);

  // Preemptively insert the metadata row so a client crash after upload still
  // shows the file in the list. If the upload fails, the metadata is orphaned —
  // we clean that up next time this node is opened (see /url handler).
  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  const session = cookie ? decodeSession(decodeURIComponent(cookie.value)) : null;
  const uploadedBy = session?.full_name || session?.email || "Unknown";

  const { data: att, error: insErr } = await sb
    .from("milestone_node_attachments")
    .insert({
      node_id: nodeId,
      owner_id: callerId,
      storage_path: storagePath,
      filename,
      content_type: contentType || null,
      size_bytes: sizeBytes ?? null,
      uploaded_by: uploadedBy,
    })
    .select()
    .single();
  if (insErr) return err(insErr.message, 400);

  return ok({
    attachment_id: att.id,
    upload_url: signed.signedUrl,
    token: signed.token,
    storage_path: storagePath,
  }, 201);
}
