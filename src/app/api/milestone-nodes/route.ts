import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson, validate } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

const KINDS = ["Milestone", "Goal", "Sub-goal", "Task"] as const;

export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const sb = createServiceClient();
  const { data: nodes, error } = await sb
    .from("milestone_nodes")
    .select("*, owner:users!milestone_nodes_owner_id_fkey(id, full_name)")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return err(error.message, 500);

  // Bulk-fetch feedback + attachment counts so the client can render the tree
  // without per-node round-trips.
  const nodeIds = (nodes || []).map((n: { id: string }) => n.id);
  let feedbackByNode: Record<string, number> = {};
  let attachmentsByNode: Record<string, number> = {};
  if (nodeIds.length > 0) {
    const [{ data: fb }, { data: att }] = await Promise.all([
      sb.from("milestone_node_feedback").select("node_id").in("node_id", nodeIds),
      sb.from("milestone_node_attachments").select("node_id").in("node_id", nodeIds),
    ]);
    for (const r of fb || []) feedbackByNode[r.node_id] = (feedbackByNode[r.node_id] || 0) + 1;
    for (const r of att || []) attachmentsByNode[r.node_id] = (attachmentsByNode[r.node_id] || 0) + 1;
  }

  return ok(
    (nodes || []).map((n: { id: string }) => ({
      ...n,
      feedback_count: feedbackByNode[n.id] || 0,
      attachment_count: attachmentsByNode[n.id] || 0,
    })),
  );
}

export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);
  const missing = validate(body, ["title", "kind"]);
  if (missing) return err(missing);
  if (!KINDS.includes(body.kind)) return err(`kind must be one of ${KINDS.join(", ")}`);

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("milestone_nodes")
    .insert({
      parent_id: body.parent_id || null,
      owner_id: callerId,
      title: body.title,
      kind: body.kind,
      assignee: body.assignee || null,
      score: body.score ?? null,
      sort_order: body.sort_order ?? 0,
      collapsed: body.collapsed ?? false,
    })
    .select("*, owner:users!milestone_nodes_owner_id_fkey(id, full_name)")
    .single();
  if (error) return err(error.message, 400);
  return ok({ ...data, feedback_count: 0, attachment_count: 0 }, 201);
}
