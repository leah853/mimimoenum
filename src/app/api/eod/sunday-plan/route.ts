import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

type GroupKey = "apex" | "platform" | "people";

/** Read-back for a specific Sunday. Returns everything created on that
 *  UTC calendar date under the three mapped Goals (or the Unplaced
 *  milestone), grouped by (Goal → Sub-goal focus → tasks). Powers the
 *  "This Sunday's plan" summary on the EOD page so a doer can see what
 *  they submitted after the form clears. */
export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!date) return err("date (yyyy-mm-dd) query param required");

  const sb = createServiceClient();
  const { data: nodesRaw } = await sb.from("milestone_nodes").select("id, parent_id, title, kind, created_at");
  const nodes = (nodesRaw || []) as {
    id: string;
    parent_id: string | null;
    title: string;
    kind: string;
    created_at: string;
  }[];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Find the three mapped Goals + Unplaced milestone.
  const milestones = nodes.filter((n) => n.kind === "Milestone");
  const goalsById = new Map(nodes.filter((n) => n.kind === "Goal").map((g) => [g.id, g]));

  function ancestryToGroup(taskId: string): { group: GroupKey | "unplaced"; goal_title: string; focus_title: string | null } | null {
    let cur = byId.get(taskId);
    let focus: string | null = null;
    // Walk up: skip Sub-goals (record first as focus), stop at Goal or Milestone.
    while (cur) {
      if (cur.id !== taskId && cur.kind === "Sub-goal" && focus === null) {
        focus = cur.title;
      }
      const parent = cur.parent_id ? byId.get(cur.parent_id) : null;
      if (!parent) break;
      if (parent.kind === "Goal") {
        const gt = parent.title.toLowerCase();
        let group: GroupKey | "unplaced" = "unplaced";
        if (gt.includes("milestone") || gt.includes("branding")) group = "apex";
        else if (gt.includes("product") || gt.includes("platform") || gt.includes("workflow") || gt.includes("fedramp") || gt.includes("engine")) group = "platform";
        else if (gt.includes("talent") || gt.includes("knowledge") || gt.includes("culture") || gt.includes("people")) group = "people";
        return { group, goal_title: parent.title, focus_title: focus };
      }
      if (parent.kind === "Milestone" && parent.title === "Unplaced plan tasks") {
        return { group: "unplaced", goal_title: "Unplaced plan tasks", focus_title: focus };
      }
      cur = parent;
    }
    return null;
  }
  void milestones; void goalsById; // referenced by ancestryToGroup indirectly through byId

  // Show every task created within the week that contains `date`
  // (Monday-Sunday, UTC). The user often plans on Sunday but submits days
  // later; matching on "exact Sunday date only" would show nothing.
  const weekMondayIso = mondayOf(date);
  const weekEnd = new Date(weekMondayIso + "T00:00:00Z");
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7); // exclusive upper bound
  const weekMondayDate = new Date(weekMondayIso + "T00:00:00Z");
  const tasksThatDay = nodes.filter((n) => {
    if (n.kind !== "Task") return false;
    const t = new Date(n.created_at);
    return t >= weekMondayDate && t < weekEnd;
  });

  type GroupSummary = {
    goal_title: string;
    focus_groups: Record<string, { focus_title: string | null; task_titles: string[] }>;
  };
  const per_category: Record<GroupKey | "unplaced", GroupSummary> = {
    apex: { goal_title: "", focus_groups: {} },
    platform: { goal_title: "", focus_groups: {} },
    people: { goal_title: "", focus_groups: {} },
    unplaced: { goal_title: "Unplaced plan tasks", focus_groups: {} },
  };
  let total = 0;

  for (const t of tasksThatDay) {
    const anc = ancestryToGroup(t.id);
    if (!anc) continue; // not under any mapped Goal — skip
    const bucket = per_category[anc.group];
    if (!bucket.goal_title) bucket.goal_title = anc.goal_title;
    const focusKey = anc.focus_title || "__flat__";
    if (!bucket.focus_groups[focusKey]) {
      bucket.focus_groups[focusKey] = { focus_title: anc.focus_title, task_titles: [] };
    }
    bucket.focus_groups[focusKey].task_titles.push(t.title);
    total += 1;
  }

  return ok({ date, total, per_category });
}

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
 *      tasks: {
 *        apex?: string[] | { focus?: string; items: string[] },
 *        platform?: ...,
 *        people?: ...,
 *      }
 *    }
 *
 *  Per category, if `focus` is set → tasks go under a Sub-goal named `focus`
 *  under the matched Goal (Sub-goal is created lazily, reused across weeks
 *  when the same focus name repeats). If `focus` is empty (or the group is
 *  a plain string[]), tasks are inserted directly under the matched Goal.
 *
 *  Returns { created, week_label, per_category: { ... focus_title, ... } }
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

  type PerCat = {
    goal_title: string;
    focus_title: string | null; // Sub-goal that was created / reused, if any
    created_task_ids: string[];
    created_task_titles: string[];
    matched: boolean;
  };

  const result: { created: number; week_label: string; per_category: Record<GroupKey, PerCat> } = {
    created: 0,
    week_label: weekLabel,
    per_category: {
      apex: { goal_title: "", focus_title: null, created_task_ids: [], created_task_titles: [], matched: false },
      platform: { goal_title: "", focus_title: null, created_task_ids: [], created_task_titles: [], matched: false },
      people: { goal_title: "", focus_title: null, created_task_ids: [], created_task_titles: [], matched: false },
    },
  };

  // Accept both shapes per group:
  //   apex: ["a","b"]                          // legacy — no focus
  //   apex: { focus: "Digital branding", items: ["a","b"] }
  function normaliseGroup(v: unknown): { focus: string; items: string[] } {
    if (Array.isArray(v)) {
      return { focus: "", items: v.map((t) => String(t || "").trim()).filter(Boolean) };
    }
    if (v && typeof v === "object") {
      const o = v as { focus?: string; items?: unknown };
      return {
        focus: String(o.focus || "").trim(),
        items: Array.isArray(o.items)
          ? (o.items as unknown[]).map((t) => String(t || "").trim()).filter(Boolean)
          : [],
      };
    }
    return { focus: "", items: [] };
  }

  try {
    for (const g of ["apex", "platform", "people"] as GroupKey[]) {
      const { focus, items } = normaliseGroup(body.tasks[g]);
      if (items.length === 0) continue;

      // Step 1: figure out which Goal we're anchored under.
      const goal = matchGoal(g);
      let goalParentId: string;
      if (goal) {
        result.per_category[g].matched = true;
        result.per_category[g].goal_title = goal.title;
        goalParentId = goal.id;
      } else {
        result.per_category[g].matched = false;
        result.per_category[g].goal_title = "Unplaced plan tasks";
        goalParentId = await unplacedMilestoneId();
      }

      // Step 2: if the user named a weekly focus, tasks nest under a
      // Sub-goal by that name. Otherwise they go straight under the Goal
      // (flat fallback). Sub-goal is reused across weeks when the same
      // focus name repeats.
      let parentId: string;
      if (focus) {
        parentId = await findOrCreateChild(goalParentId, focus, "Sub-goal");
        result.per_category[g].focus_title = focus;
      } else {
        parentId = goalParentId;
      }

      // Step 3: insert each task title under the chosen parent, skipping
      // titles that already exist so re-submits are a no-op.
      const existingTitles = new Set(kidsOf(parentId).map((n) => n.title));
      const fresh = items.filter((t) => !existingTitles.has(t));

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
