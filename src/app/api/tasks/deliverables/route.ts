import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

/** Feed for the /deliverables page — task-side. Returns every deliverable
 *  uploaded against a task (or its subtask), joined with the task's title,
 *  category, owner, and deadline. Client buckets by (category → month) using
 *  the deliverable's created_at as the month key. This is the "Tasks tab"
 *  counterpart to /api/milestone-nodes/deliverables. */
export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const sb = createServiceClient();

  const { data: dels, error: dErr } = await sb
    .from("deliverables")
    .select("id, task_id, subtask_id, title, file_url, file_name, file_size_bytes, version, uploaded_by, created_at")
    .order("created_at", { ascending: false });
  if (dErr) return err(dErr.message, 500);

  const { data: tasks, error: tErr } = await sb
    .from("tasks")
    .select("id, title, category, deadline, owner_id");
  if (tErr) return err(tErr.message, 500);

  const { data: subs, error: sErr } = await sb
    .from("subtasks")
    .select("id, title, task_id");
  if (sErr) return err(sErr.message, 500);

  const { data: users, error: uErr } = await sb
    .from("users")
    .select("id, full_name");
  if (uErr) return err(uErr.message, 500);

  type Task = { id: string; title: string; category: string | null; deadline: string | null; owner_id: string | null };
  type Sub = { id: string; title: string; task_id: string };
  type User = { id: string; full_name: string | null };
  type Del = {
    id: string;
    task_id: string | null;
    subtask_id: string | null;
    title: string | null;
    file_url: string | null;
    file_name: string | null;
    file_size_bytes: number | null;
    version: number | null;
    uploaded_by: string | null;
    created_at: string;
  };

  const taskById = new Map<string, Task>();
  for (const t of (tasks || []) as Task[]) taskById.set(t.id, t);
  const subById = new Map<string, Sub>();
  for (const s of (subs || []) as Sub[]) subById.set(s.id, s);
  const userById = new Map<string, User>();
  for (const u of (users || []) as User[]) userById.set(u.id, u);

  const items = ((dels || []) as Del[])
    .map((d) => {
      // Resolve owning task (either direct or via subtask).
      const sub = d.subtask_id ? subById.get(d.subtask_id) || null : null;
      const taskId = d.task_id || (sub ? sub.task_id : null);
      const t = taskId ? taskById.get(taskId) || null : null;
      if (!t) return null;

      // Month key comes from created_at (upload date); falls back to task
      // deadline if the row somehow has no timestamp.
      const monthSource = d.created_at || t.deadline || null;
      if (!monthSource) return null;

      const owner = t.owner_id ? userById.get(t.owner_id) || null : null;
      return {
        attachment_id: `t:${d.id}`,
        source: "task" as const,
        task_id: t.id,
        subtask_id: d.subtask_id,
        node_id: null,
        node_title: sub ? sub.title : t.title,
        node_score: null,
        goal_id: null,
        goal_title: t.category || "Unattributed",
        path: sub ? [t.title] : [],
        kind: (d.file_url ? "file" : "text") as "file" | "link" | "text",
        filename: d.title || d.file_name || "Deliverable",
        link_url: d.file_url || null,
        size_bytes: d.file_size_bytes,
        uploaded_by: d.uploaded_by || "",
        uploaded_at: monthSource,
        reviewed: false,
        reviewed_at: null,
        task_title: t.title,
        task_deadline: t.deadline,
        owner_name: owner ? owner.full_name : null,
        version: d.version,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return ok({ items });
}
