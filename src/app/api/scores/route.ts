import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate } from "@/lib/api-helpers";

// GET — fetch all score overrides
export async function GET() {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("score_overrides")
    .select("*, set_by_user:users!score_overrides_set_by_fkey(id, full_name)")
    .order("created_at", { ascending: false });

  if (error) return err(error.message, 500);
  return ok(data);
}

// POST — upsert a score override (default is cumulative, this overrides)
export async function POST(request: NextRequest) {
  const sb = createServiceClient();
  const body = await request.json();

  const missing = validate(body, ["target_type", "target_id", "score"]);
  if (missing) return err(missing);

  if (!["quarter", "iteration", "week"].includes(body.target_type)) {
    return err("target_type must be quarter, iteration, or week");
  }

  if (body.score < 0 || body.score > 10) {
    return err("Score must be between 0 and 10");
  }

  const { data, error } = await sb
    .from("score_overrides")
    .upsert({
      target_type: body.target_type,
      target_id: body.target_id,
      score: body.score,
      set_by: body.set_by || null,
    }, { onConflict: "target_type,target_id" })
    .select()
    .single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}

// DELETE — remove override, revert to cumulative
export async function DELETE(request: NextRequest) {
  const sb = createServiceClient();
  const { searchParams } = new URL(request.url);
  const targetType = searchParams.get("target_type");
  const targetId = searchParams.get("target_id");

  if (!targetType || !targetId) return err("target_type and target_id required");

  const { error } = await sb
    .from("score_overrides")
    .delete()
    .eq("target_type", targetType)
    .eq("target_id", targetId);

  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
