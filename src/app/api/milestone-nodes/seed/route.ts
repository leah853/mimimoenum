import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

// Transcribed from the hand-drawn Milestone 1 map. All nodes start grey
// (no score, owner, or attachment). '?' marks labels the transcriber wasn't
// sure of — edit in-app.

type Kind = "Milestone" | "Goal" | "Sub-goal" | "Task";
type SeedNode = { title: string; kind: Kind; collapsed?: boolean; children?: SeedNode[] };

const SEED: SeedNode = {
  title: "Milestone 1",
  kind: "Milestone",
  children: [
    {
      title: "Talent and Knowledge & Culture",
      kind: "Goal",
      collapsed: true,
      children: [
        {
          title: "Talent",
          kind: "Sub-goal",
          children: [
            {
              title: "Hiring",
              kind: "Sub-goal",
              children: [
                {
                  title: "Hackathon?",
                  kind: "Task",
                  children: [
                    { title: "Website", kind: "Task" },
                    { title: "Host?", kind: "Task" },
                    { title: "Marketing campaign", kind: "Task" },
                  ],
                },
              ],
            },
            {
              title: "Post-hiring",
              kind: "Sub-goal",
              children: [
                { title: "Training plan", kind: "Task" },
                { title: "Consultants", kind: "Task" },
                { title: "Content", kind: "Task" },
              ],
            },
          ],
        },
        { title: "KLC (Knowledge & Culture)", kind: "Sub-goal" },
      ],
    },
    {
      title: "Milestone and Branding",
      kind: "Goal",
      collapsed: true,
      children: [
        {
          title: "80% CHCs in TOFU: National",
          kind: "Sub-goal",
          children: [
            {
              title: "80% CHCs in Florida?",
              kind: "Sub-goal",
              children: [
                {
                  title: "core Branding (CHCs)",
                  kind: "Sub-goal",
                  children: [
                    { title: "Website?", kind: "Task" },
                    { title: "LinkedIn?", kind: "Task" },
                    { title: '"Instagram"?', kind: "Task" },
                    { title: "FB?", kind: "Task" },
                    { title: "Conference chats?", kind: "Task" },
                  ],
                },
              ],
            },
          ],
        },
        {
          title: "1 MSA growth",
          kind: "Sub-goal",
          children: [
            { title: "Third: grown? (unreadable)", kind: "Task" },
            {
              title: "TOFU",
              kind: "Sub-goal",
              children: [
                { title: "funnel campaign architecture?", kind: "Task" },
                { title: "funnel transitions", kind: "Task" },
              ],
            },
            {
              title: "Messaging architecture",
              kind: "Sub-goal",
              children: [
                { title: "channel release workflow?", kind: "Task" },
                { title: "trust campaign architecture?", kind: "Task" },
                {
                  title: "channel specific architecture?",
                  kind: "Sub-goal",
                  children: [
                    { title: "Manual workflow", kind: "Task" },
                    { title: "AI workflow → invoke a BE side?", kind: "Task" },
                  ],
                },
                {
                  title: "Actuation?",
                  kind: "Sub-goal",
                  children: [{ title: "channel agents?", kind: "Task" }],
                },
              ],
            },
            { title: "PG implementations?", kind: "Sub-goal" },
            { title: "HHAH implementations?", kind: "Sub-goal" },
            { title: "core Branding (MSA)", kind: "Sub-goal" },
          ],
        },
      ],
    },
    {
      title: "Product, Workflows and Fedramp",
      kind: "Goal",
      collapsed: true,
      children: [
        {
          title: "Workflows + eng?",
          kind: "Sub-goal",
          children: [
            {
              title: "MVP",
              kind: "Sub-goal",
              children: [
                {
                  title: "MVP workflows",
                  kind: "Sub-goal",
                  children: [{ title: "PhA MVP: one workflow: ready for use?", kind: "Task" }],
                },
              ],
            },
            {
              title: "Scale readiness?",
              kind: "Sub-goal",
              children: [
                { title: "MVP suite?", kind: "Task" },
                { title: "Design review", kind: "Task" },
              ],
            },
            {
              title: "AI agents",
              kind: "Sub-goal",
              children: [
                { title: "HHAH login?", kind: "Task" },
                { title: "Practice logins", kind: "Task" },
                { title: "Orchestrator logins?", kind: "Task" },
                { title: "Internal user logins?", kind: "Task" },
                { title: "Native activities built?", kind: "Task" },
              ],
            },
          ],
        },
        {
          title: "Fedramp",
          kind: "Sub-goal",
          children: [
            {
              title: "20X Practice?",
              kind: "Sub-goal",
              children: [
                { title: "Class identification?", kind: "Task" },
                { title: "Timeline", kind: "Task" },
                { title: "Application readiness?", kind: "Task" },
              ],
            },
            { title: "Resources", kind: "Task" },
            { title: "Execution", kind: "Task" },
            { title: "Apply", kind: "Task" },
          ],
        },
      ],
    },
  ],
};

/** One-shot: create the entire Milestone 1 seed tree in the DB. Refuses if
 *  ANY milestone_nodes already exist, so it can't accidentally clone. Doers
 *  and admins only — reps have no reason to seed. */
export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  if (role !== "doer" && role !== "admin") return err("Only doers/admins can seed the tree", 403);

  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);

  const sb = createServiceClient();
  const { count } = await sb.from("milestone_nodes").select("id", { count: "exact", head: true });
  if ((count || 0) > 0) {
    return err("Tree is not empty — clear existing nodes before seeding", 409);
  }

  let inserted = 0;
  async function insert(node: SeedNode, parentId: string | null, sortOrder: number): Promise<void> {
    const { data, error } = await sb
      .from("milestone_nodes")
      .insert({
        parent_id: parentId,
        owner_id: callerId,
        title: node.title,
        kind: node.kind,
        sort_order: sortOrder,
        collapsed: node.collapsed ?? false,
      })
      .select("id")
      .single();
    if (error) throw new Error(`insert(${node.title}): ${error.message}`);
    inserted += 1;
    const children = node.children || [];
    for (let i = 0; i < children.length; i++) {
      await insert(children[i], data.id, i);
    }
  }

  try {
    await insert(SEED, null, 0);
  } catch (e) {
    return err(e instanceof Error ? e.message : "Seed failed", 500);
  }

  return ok({ inserted }, 201);
}
