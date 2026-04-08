import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate } from "@/lib/api-helpers";

export async function POST(request: NextRequest) {
  const sb = createServiceClient();
  const body = await request.json();

  const missing = validate(body, ["eod_update_id", "user_id", "comment"]);
  if (missing) return err(missing);

  const { data, error } = await sb
    .from("eod_comments")
    .insert(body)
    .select("*, user:users!eod_comments_user_id_fkey(id, full_name)")
    .single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}
