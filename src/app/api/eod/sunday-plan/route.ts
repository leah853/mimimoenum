import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

type GroupKey = "apex" | "platform" | "people";

// Fuzzy-match each EOD category to a Goal by title keywords. Ordered by
// preference so the first hit wins.
const GOAL_KEYWORDS: Record<GroupKey, string[]> = {
  apex: ["milestone", "branding"],
  platform: ["product", "platform", "workflow", "fedramp", "engine"],
  people: ["talent", "knowledge", "culture", "people"],
};

const CATEGORY_LABEL: Record<GroupKey, string> = {
  apex: "Milestone Execution & Branding",
  platform: "Platform — Core Engine",
  people: "People",
};

/** ISO date (yyyy-mm-dd) of the Monday of the week containing `dateStr`.
 *  Weeks are Monday-Sunday. Sunday belongs to the same week as the preceding
 *  Monday (so Sunday planning targets the "current" week). */
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const monOffset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + monOffset);
  return d.toISOString().slice(0, 10);
}

function friendlyMonday(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

type NodeRow = { id: string; parent_id: string | null; title: string; kind: string };

/** Post one Sunday plan. Body:
 *    { date: "2026-07-19",
 *      tasks: { apex?: string[], platform?: string[], people?: string[] } }
 *  Returns { created, per_category: { apex: {goal_title, sub_goal_title, count} ... } }
 */
export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);

  const body = await safeJson(request);
  if (!body || !body.date || typeof body.date !== "string") return err("date (yyyy-mm-dd) required");
  if (!body.tasks || typeof body.tasks !== "object") return err("tasks object required");

  const sb = createServiceClient();

  // Load every node once — tree is small enough to walk in memory.
  const { data: rawNodes, error: nodeErr } = await sb
    .from("milestone_nodes")
    .select("id, parent_id, title, kind");
  if (nodeErr) return err(nodeErr.message, 500);
  const nodes = (rawNodes || []) as NodeRow[];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kidsOf = (id: string | null) => nodes.filter((n) => n.parent_id === id);

  // Prefer the FIRST milestone we find as the anchor. In this app that's
  // "Milestone 1"; if the tree grows later we may need to pass a milestone_id.
  const milestone = nodes.find((n) => n.kind === "Milestone");
  if (!milestone) return err("No Milestone root exists yet — create one first", 422);

  const goalsUnderMilestone = kidsOf(milestone.id).filter((n) => n.kind === "Goal");
  function matchGoal(group: GroupKey): NodeRow | null {
    const kws = GOAL_KEYWORDS[group];
    for (const kw of kws) {
      const hit = goalsUnderMilestone.find((g) => g.title.toLowerCase().includes(kw));
      if (hit) return hit;
    }
    return null;
  }

  async function findOrCreateChild(parentId: string, title: string, kind: string): Promise<string> {
    const existing = kidsOf(parentId).find((n) => n.title === title && n.kind === kind);
    if (existing) return existing.id;
    const { data, error } = await sb
      .from("milestone_nodes")
      .insert({
        parent_id: parentId,
        owner_id: callerId,
        title,
        kind,
        sort_order: kidsOf(parentId).length,
      })
      .select("id, parent_id, title, kind")
      .single();
    if (error) throw new Error(`create ${kind} "${title}": ${error.message}`);
    const row = data as NodeRow;
    nodes.push(row);
    byId.set(row.id, row);
    return row.id;
  }

  // Unplaced fallback: create/reuse a top-level Milestone called "Unplaced
  // plan tasks" and drop tasks directly under it. Prevents silent loss of
  // user input when a category can't find its Goal home.
  async function unplacedMilestoneId(): Promise<string> {
    const existing = nodes.find((n) => n.kind === "Milestone" && n.title === "Unplaced plan tasks");
    if (existing) return existing.id;
    const { data, error } = await sb
      .from("milestone_nodes")
      .insert({
        parent_id: null,
        owner_id: callerId,
        title: "Unplaced plan tasks",
        kind: "Milestone",
        sort_order: nodes.filter((n) => !n.parent_id).length,
      })
      .select("id, parent_id, title, kind")
      .single();
    if (error) throw new Error(`create Unplaced milestone: ${error.message}`);
    const row = data as NodeRow;
    nodes.push(row);
    byId.set(row.id, row);
    return row.id;
  }

  // Weekly Monday, kept for the response so the frontend can tell the user
  // which week these tasks belong to (based on created_at + label).
  const weekMonday = mondayOf(body.date);
  const weekLabel = friendlyMonday(weekMonday);

  const result: {
    created: number;
    week_label: string;
    per_category: Record<GroupKey, { goal_title: string; created_task_ids: string[]; created_task_titles: string[]; matched: boolean }>;
  } = {
    created: 0,
    week_label: weekLabel,
    per_category: {
      apex: { goal_title: "", created_task_ids: [], created_task_titles: [], matched: false },
      platform: { goal_title: "", created_task_ids: [], created_task_titles: [], matched: false },
      people: { goal_title: "", created_task_ids: [], created_task_titles: [], matched: false },
    },
  };

  try {
    for (const g of ["apex", "platform", "people"] as GroupKey[]) {
      const rawTitles: string[] = Array.isArray(body.tasks[g]) ? body.tasks[g] : [];
      const titles = rawTitles.map((t) => String(t || "").trim()).filter(Boolean);
      if (titles.length === 0) continue;

      const goal = matchGoal(g);
      // Direct parent for the tasks — no intermediate "Week of ..." wrapper.
      // Matched → the Goal itself. Unmatched → the Unplaced milestone.
      let parentId: string;
      if (goal) {
        result.per_category[g].matched = true;
        result.per_category[g].goal_title = goal.title;
        parentId = goal.id;
      } else {
        result.per_category[g].matched = false;
        result.per_category[g].goal_title = "Unplaced plan tasks";
        parentId = await unplacedMilestoneId();
      }

      // Skip titles that already exist under the same parent so re-submits
      // are a no-op.
      const existingTitles = new Set(kidsOf(parentId).map((n) => n.title));
      const fresh = titles.filter((t) => !existingTitles.has(t));

      for (const [i, t] of fresh.entries()) {
        const { data, error: e } = await sb
          .from("milestone_nodes")
          .insert({
            parent_id: parentId,
            owner_id: callerId,
            title: t,
            kind: "Task",
            sort_order: kidsOf(parentId).length + i,
          })
          .select("id, parent_id, title, kind")
          .single();
        if (e) throw new Error(`insert Task "${t}": ${e.message}`);
        const row = data as NodeRow;
        nodes.push(row);
        result.per_category[g].created_task_ids.push(row.id);
        result.per_category[g].created_task_titles.push(t);
      }
    }
    result.created = (["apex", "platform", "people"] as GroupKey[]).reduce(
      (s, g) => s + result.per_category[g].created_task_ids.length,
      0,
    );
  } catch (e) {
    return err(e instanceof Error ? e.message : "Sunday plan sync failed", 500);
  }

  return ok(result, 201);
}

// Small utility export so the frontend can use the same labels.
export const _CATEGORY_LABEL = CATEGORY_LABEL;
