import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  const sb = createServiceClient();
  const taskId = new URL(request.url).searchParams.get("task_id");

  let query = sb.from("subtasks").select("*, owner:users!subtasks_owner_id_fkey(id, full_name)");
  if (taskId) query = query.eq("task_id", taskId);

  const { data, error } = await query;
  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest) {
  const sb = createServiceClient();
  const body = await request.json();

  const missing = validate(body, ["task_id", "title"]);
  if (missing) return err(missing);

  const { data, error } = await sb.from("subtasks").insert(body).select().single();
  if (error) return err(error.message, 400);
  return ok(data, 201);
}

export async function PATCH(request: NextRequest) {
  const sb = createServiceClient();
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) return err("Missing subtask id");

  const { data, error } = await sb.from("subtasks").update(updates).eq("id", id).select().single();
  if (error) return err(error.message, 400);
  return ok(data);
}
