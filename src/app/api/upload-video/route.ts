import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

/** Generic video upload — returns public URL. Used by EOD and other places that
 *  don't store files in the deliverables table but still need video attachments. */
export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const sb = createServiceClient();
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const folder = (formData.get("folder") as string) || "videos";

  if (!file) return err("No file provided");
  if (file.size === 0) return err("File is empty");
  // Limit 50MB for videos
  if (file.size > 50 * 1024 * 1024) return err("Video too large (max 50MB)");

  const ext = file.name.split(".").pop() || "mp4";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error: upErr } = await sb.storage.from("deliverables").upload(path, file);
  if (upErr) return err(`Upload failed: ${upErr.message}`, 500);

  const { data: { publicUrl } } = sb.storage.from("deliverables").getPublicUrl(path);
  return ok({ url: publicUrl, name: file.name, size: file.size });
}
