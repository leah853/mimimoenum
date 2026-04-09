import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate, safeJson } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const sb = createServiceClient();
  const quarterId = new URL(request.url).searchParams.get("quarter_id");

  let query = sb.from("quarter_goals").select("*").order("category").order("sort_order");
  if (quarterId) query = query.eq("quarter_id", quarterId);

  const { data, error } = await query;
  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const sb = createServiceClient();
  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);
  const missing = validate(body, ["quarter_id", "category", "goal"]);
  if (missing) return err(missing);

  const { data, error } = await sb.from("quarter_goals").insert(body).select().single();
  if (error) return err(error.message, 400);
  return ok(data, 201);
}

export async function DELETE(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const sb = createServiceClient();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return err("id required");
  const { error } = await sb.from("quarter_goals").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
