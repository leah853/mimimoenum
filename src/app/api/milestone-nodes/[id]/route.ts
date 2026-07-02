import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

const EDITABLE_FIELDS = ["title", "kind", "assignee", "score", "parent_id", "sort_order", "collapsed"] as const;
const KINDS = ["Milestone", "Goal", "Sub-goal", "Task"] as const;

async function canWrite(request: NextRequest, sb: ReturnType<typeof createServiceClient>, nodeId: string) {
  const role = getCallerRole(request);
  if (!role) return { allowed: false, code: 401, msg: "Not authenticated" };
  if (role === "admin") return { allowed: true };
  const callerId = await getCallerId(request);
  if (!callerId) return { allowed: false, code: 401, msg: "Could not verify identity" };
  const { data: node } = await sb.from("milestone_nodes").select("owner_id").eq("id", nodeId).maybeSingle();
  if (!node) return { allowed: false, code: 404, msg: "Node not found" };
  // Doers can edit any node (collaborative model); reps cannot edit structure.
  if (role === "doer") return { allowed: true };
  return { allowed: false, code: 403, msg: "Forbidden" };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createServiceClient();
  const perm = await canWrite(request, sb, id);
  if (!perm.allowed) return err(perm.msg!, perm.code!);

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);
  if (body.kind && !KINDS.includes(body.kind)) return err(`kind must be one of ${KINDS.join(", ")}`);

  // Prevent making a node its own ancestor (would create a cycle).
  if (body.parent_id === id) return err("A node cannot be its own parent", 422);

  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE_FIELDS) if (k in body) patch[k] = body[k];
  if (Object.keys(patch).length === 0) return err("No editable fields provided", 400);

  const { data, error } = await sb.from("milestone_nodes").update(patch).eq("id", id).select().single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createServiceClient();
  const perm = await canWrite(request, sb, id);
  if (!perm.allowed) return err(perm.msg!, perm.code!);

  // Delete storage objects for all attachments under this subtree. The DB
  // cascade removes rows; we must separately remove the underlying files.
  // supabase-js doesn't expose recursive CTEs, so BFS the tree client-side.
  const { data: allNodes } = await sb.from("milestone_nodes").select("id, parent_id");
  const subtreeIds = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of allNodes || []) {
      if (n.parent_id && subtreeIds.has(n.parent_id) && !subtreeIds.has(n.id)) {
        subtreeIds.add(n.id);
        changed = true;
      }
    }
  }
  const { data: attachments } = await sb
    .from("milestone_node_attachments")
    .select("id, storage_path")
    .in("node_id", [...subtreeIds]);
  const paths = (attachments || []).map((a: { storage_path: string }) => a.storage_path);
  if (paths.length > 0) {
    await sb.storage.from("milestone_attachments").remove(paths);
  }

  const { error } = await sb.from("milestone_nodes").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
