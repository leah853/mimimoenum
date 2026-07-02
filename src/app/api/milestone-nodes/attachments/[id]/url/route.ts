import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

const BUCKET = "milestone_attachments";
const SIGNED_URL_TTL_SECONDS = 300; // 5 min

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;

  const sb = createServiceClient();
  const { data: att, error } = await sb
    .from("milestone_node_attachments")
    .select("storage_path, filename, content_type")
    .eq("id", id)
    .maybeSingle();
  if (error) return err(error.message, 500);
  if (!att) return err("Attachment not found", 404);

  const { data: signed, error: signErr } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(att.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: att.filename,
    });
  if (signErr) return err(signErr.message, 500);

  return ok({ url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
}
