import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

/** Feed for the /deliverables page. Returns every submission across the
 *  milestone tree, resolved to its parent Goal, ordered newest-first. Client
 *  buckets by (goal → month). Node score is included so we can paint the
 *  right status pill ("Reviewed · 9/10" / "Needs review"). */
export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const sb = createServiceClient();

  const { data: nodes, error: nErr } = await sb
    .from("milestone_nodes")
    .select("id, parent_id, title, kind, score");
  if (nErr) return err(nErr.message, 500);
  type Row = { id: string; parent_id: string | null; title: string; kind: string; score: number | null };
  const byId = new Map<string, Row>();
  for (const n of (nodes || []) as Row[]) byId.set(n.id, n);

  const { data: atts, error: aErr } = await sb
    .from("milestone_node_attachments")
    .select("id, node_id, kind, filename, uploaded_by, uploaded_at, reviewed, reviewed_at, link_url, size_bytes")
    .order("uploaded_at", { ascending: false });
  if (aErr) return err(aErr.message, 500);

  // Walk up until we hit a Goal.
  function ancestry(nodeId: string): {
    goal_id: string | null;
    goal_title: string;
    path: string[];
    node_title: string;
    node_score: number | null;
  } {
    const start = byId.get(nodeId);
    if (!start) return { goal_id: null, goal_title: "Unknown", path: [], node_title: "?", node_score: null };
    const path: string[] = [];
    let cur: Row | null = start;
    while (cur) {
      if (cur.kind === "Goal") {
        return { goal_id: cur.id, goal_title: cur.title, path: path.reverse(), node_title: start.title, node_score: start.score };
      }
      if (cur.id !== nodeId) path.push(cur.title);
      const parent: Row | null = cur.parent_id ? byId.get(cur.parent_id) || null : null;
      if (!parent) {
        return {
          goal_id: null,
          goal_title: cur.kind === "Milestone" ? cur.title : "Unattributed",
          path: path.reverse(),
          node_title: start.title,
          node_score: start.score,
        };
      }
      cur = parent;
    }
    return { goal_id: null, goal_title: "Unknown", path: [], node_title: start.title, node_score: start.score };
  }

  type AttRow = {
    id: string;
    node_id: string;
    kind: string | null;
    filename: string;
    uploaded_by: string;
    uploaded_at: string;
    reviewed: boolean | null;
    reviewed_at: string | null;
    link_url: string | null;
    size_bytes: number | null;
  };
  const items = ((atts || []) as AttRow[]).map((a) => {
    const anc = ancestry(a.node_id);
    return {
      attachment_id: a.id,
      node_id: a.node_id,
      node_title: anc.node_title,
      node_score: anc.node_score,
      goal_id: anc.goal_id,
      goal_title: anc.goal_title,
      path: anc.path,
      kind: (a.kind || "file") as "file" | "link" | "text",
      filename: a.filename,
      link_url: a.link_url,
      size_bytes: a.size_bytes,
      uploaded_by: a.uploaded_by,
      uploaded_at: a.uploaded_at,
      reviewed: a.reviewed === true,
      reviewed_at: a.reviewed_at,
    };
  });

  return ok({ items });
}
