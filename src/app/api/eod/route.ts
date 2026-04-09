import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, validate } from "@/lib/api-helpers";
import { isDoerOrAdmin } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const sb = createServiceClient();
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");
  const date = searchParams.get("date");

  let query = sb
    .from("eod_updates")
    .select(`
      *,
      user:users!eod_updates_user_id_fkey(id, full_name, email),
      linked_tasks:eod_update_tasks(task:tasks!eod_update_tasks_task_id_fkey(id, title, status)),
      comments:eod_comments(*, user:users!eod_comments_user_id_fkey(id, full_name))
    `)
    .order("date", { ascending: false });

  if (userId) query = query.eq("user_id", userId);
  if (date) query = query.eq("date", date);

  const { data, error } = await query;
  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest) {
  if (!isDoerOrAdmin(request)) return err("Only doers can submit EOD updates", 403);

  const sb = createServiceClient();
  const body = await request.json();
  const { linked_task_ids, ...eodData } = body;

  const missing = validate(eodData, ["user_id", "what_was_done"]);
  if (missing) return err(missing);

  if (!eodData.date) eodData.date = new Date().toISOString().split("T")[0];

  const { data, error } = await sb
    .from("eod_updates")
    .upsert(eodData, { onConflict: "user_id,date" })
    .select()
    .single();

  if (error) return err(error.message, 400);

  // Link tasks
  if (linked_task_ids?.length) {
    await sb.from("eod_update_tasks").delete().eq("eod_update_id", data.id);
    const links = linked_task_ids.map((taskId: string) => ({
      eod_update_id: data.id,
      task_id: taskId,
    }));
    const { error: linkError } = await sb.from("eod_update_tasks").insert(links);
    if (linkError) return err(`Task linking failed: ${linkError.message}`, 400);
  }

  return ok(data, 201);
}
