import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate } from "@/lib/api-helpers";

export async function GET() {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("dependencies")
    .select("*, task:tasks!dependencies_task_id_fkey(id, title, status), depends_on:tasks!dependencies_depends_on_task_id_fkey(id, title, status)");

  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest) {
  const sb = createServiceClient();
  const body = await request.json();

  const missing = validate(body, ["task_id", "depends_on_task_id"]);
  if (missing) return err(missing);

  if (body.task_id === body.depends_on_task_id) {
    return err("Task cannot depend on itself");
  }

  // Check both tasks exist
  const { data: t1 } = await sb.from("tasks").select("id").eq("id", body.task_id).single();
  const { data: t2 } = await sb.from("tasks").select("id").eq("id", body.depends_on_task_id).single();
  if (!t1 || !t2) return err("One or both tasks not found", 404);

  const { data, error } = await sb.from("dependencies").insert(body).select().single();
  if (error) return err(error.message, 400);
  return ok(data, 201);
}

export async function DELETE(request: NextRequest) {
  const sb = createServiceClient();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return err("Missing dependency id");

  const { error } = await sb.from("dependencies").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
