import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId, isDoerOrAdmin } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";

const BUCKET = "planner_attachments";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("planner_item_attachments")
    .select("id, kind, filename, link_url, text_body, content_type, size_bytes, uploaded_by, uploaded_at, reviewed")
    .eq("item_id", id)
    .order("uploaded_at", { ascending: false });
  if (error) return err(error.message, 500);
  return ok(data);
}

/**
 * Attach a deliverable to a planner card. Three kinds, matching the milestone
 * module:
 *   - file: returns a signed upload URL; the client PUTs the bytes straight to
 *           Supabase Storage, sidestepping Vercel's 4.5 MB body limit.
 *   - link: { filename (label), link_url } — never touches storage.
 *   - text: { filename (label), text_body } — never touches storage.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  // Owners submit deliverables; reps review them.
  if (!isDoerOrAdmin(request)) return err("Only owners can attach deliverables", 403);
  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);
  const { id: itemId } = await params;

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  const kind: "file" | "link" | "text" = body.kind === "link" || body.kind === "text" ? body.kind : "file";
  const filename: string | undefined = body.filename?.trim();
  if (!filename) return err("filename (label) required");

  const boardId = new URL(request.url).searchParams.get("board") || "default";
  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  const session = cookie ? decodeSession(decodeURIComponent(cookie.value)) : null;
  const uploadedBy = session?.full_name || session?.email || "Unknown";

  const sb = createServiceClient();
  const base = { item_id: itemId, board_id: boardId, owner_id: callerId, kind, filename, uploaded_by: uploadedBy };

  if (kind === "link") {
    if (!body.link_url) return err("link_url required for kind=link");
    const { data, error } = await sb
      .from("planner_item_attachments")
      .insert({ ...base, link_url: body.link_url })
      .select("id, kind, filename, link_url, text_body, uploaded_by, uploaded_at, reviewed")
      .single();
    if (error) return err(error.message, 400);
    return ok({ attachment: data }, 201);
  }

  if (kind === "text") {
    if (!body.text_body) return err("text_body required for kind=text");
    const { data, error } = await sb
      .from("planner_item_attachments")
      .insert({ ...base, text_body: body.text_body })
      .select("id, kind, filename, link_url, text_body, uploaded_by, uploaded_at, reviewed")
      .single();
    if (error) return err(error.message, 400);
    return ok({ attachment: data }, 201);
  }

  // Strip anything that could escape the key namespace, and keep the tail so
  // the extension survives.
  const safeBase = filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80);
  const storagePath = `planner_items/${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;

  const { data: signed, error: signErr } = await sb.storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (signErr) return err(signErr.message, 500);

  const { data, error } = await sb
    .from("planner_item_attachments")
    .insert({
      ...base,
      storage_path: storagePath,
      content_type: body.content_type || null,
      size_bytes: typeof body.size_bytes === "number" ? body.size_bytes : null,
    })
    .select("id, kind, filename, content_type, size_bytes, uploaded_by, uploaded_at, reviewed")
    .single();
  if (error) return err(error.message, 400);

  return ok({ attachment: data, upload_url: signed.signedUrl, token: signed.token, storage_path: storagePath }, 201);
}
