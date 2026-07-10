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
    .select(
      "id, kind, filename, link_url, text_body, content_type, size_bytes, uploaded_by, uploaded_at, reviewed, reviewed_at, reviewed_by",
    )
    .eq("node_id", id)
    .order("uploaded_at", { ascending: false });
  if (error) return err(error.message, 500);
  return ok(data);
}

/** Create a submission attached to a node. Supports three kinds:
 *    - file: caller receives a signed upload URL and PUTs the file directly
 *            to Supabase Storage (avoids Vercel's 4.5 MB serverless body cap).
 *    - link: caller passes { filename (label), link_url }. Nothing hits storage.
 *    - text: caller passes { filename (label), text_body }. Nothing hits storage.
 *
 *  Every new submission starts with reviewed=false so the UI can highlight it
 *  as "pending review" until someone marks it seen.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);
  const { id: nodeId } = await params;

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  const kind: "file" | "link" | "text" = body.kind === "link" || body.kind === "text" ? body.kind : "file";
  const filename: string | undefined = body.filename;
  if (!filename) return err("filename (label) required");

  const sb = createServiceClient();

  const { data: node } = await sb.from("milestone_nodes").select("id").eq("id", nodeId).maybeSingle();
  if (!node) return err("Node not found", 404);

  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  const session = cookie ? decodeSession(decodeURIComponent(cookie.value)) : null;
  const uploadedBy = session?.full_name || session?.email || "Unknown";

  // --- Link / text — pure DB, no storage ------------------------------------
  if (kind === "link") {
    const linkUrl: string | undefined = body.link_url;
    if (!linkUrl) return err("link_url required for kind=link");
    const { data: att, error: insErr } = await sb
      .from("milestone_node_attachments")
      .insert({
        node_id: nodeId,
        owner_id: callerId,
        kind,
        filename,
        link_url: linkUrl,
        uploaded_by: uploadedBy,
      })
      .select()
      .single();
    if (insErr) return err(insErr.message, 400);
    return ok({ attachment: att }, 201);
  }

  if (kind === "text") {
    const textBody: string | undefined = body.text_body;
    if (!textBody) return err("text_body required for kind=text");
    const { data: att, error: insErr } = await sb
      .from("milestone_node_attachments")
      .insert({
        node_id: nodeId,
        owner_id: callerId,
        kind,
        filename,
        text_body: textBody,
        uploaded_by: uploadedBy,
      })
      .select()
      .single();
    if (insErr) return err(insErr.message, 400);
    return ok({ attachment: att }, 201);
  }

  // --- File — signed upload URL flow ---------------------------------------
  const contentType: string | undefined = body.content_type;
  const sizeBytes: number | undefined = typeof body.size_bytes === "number" ? body.size_bytes : undefined;

  const safeBase = filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80);
  const storagePath = `milestone_nodes/${nodeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;

  const { data: signed, error: signErr } = await sb.storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (signErr) return err(signErr.message, 500);

  const { data: att, error: insErr } = await sb
    .from("milestone_node_attachments")
    .insert({
      node_id: nodeId,
      owner_id: callerId,
      kind: "file",
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
