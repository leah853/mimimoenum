import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

/** Returns a signed upload URL so the browser can upload directly to Supabase
 *  storage without going through our serverless function (bypasses Vercel's
 *  4.5 MB body limit for large files like videos). */
export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);
  const { filename, folder } = body as { filename?: string; folder?: string };
  if (!filename) return err("filename required");

  const sb = createServiceClient();
  const ext = (filename.split(".").pop() || "bin").toLowerCase();
  const safeFolder = (folder || "uploads").replace(/[^a-zA-Z0-9_-]/g, "-");
  const path = `${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { data, error } = await sb.storage.from("deliverables").createSignedUploadUrl(path);
  if (error) return err(error.message, 500);

  const { data: { publicUrl } } = sb.storage.from("deliverables").getPublicUrl(path);

  return ok({
    uploadUrl: data.signedUrl,
    token: data.token,
    path,
    publicUrl,
  });
}
