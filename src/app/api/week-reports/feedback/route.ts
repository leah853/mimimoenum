import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate, safeJson } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const sb = createServiceClient();
  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  const missing = validate(body, ["week_report_id", "reviewer_id", "rating"]);
  if (missing) return err(missing);

  if (body.rating < 1 || body.rating > 10) return err("Rating must be 1-10");

  const { data, error } = await sb
    .from("week_report_feedback")
    .insert(body)
    .select("*, reviewer:users!week_report_feedback_reviewer_id_fkey(id, full_name)")
    .single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}
