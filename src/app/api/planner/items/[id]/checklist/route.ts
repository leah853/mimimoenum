import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, isDoerOrAdmin } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";

/** Ops/infra checklist items belonging to one planner card. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("planner_item_checklist")
    .select("id, label, done, done_at, done_by, created_by, created_at, sort_order")
    .eq("item_id", id)
    .order("sort_order")
    .order("created_at");
  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  if (!isDoerOrAdmin(request)) return err("Only owners can add checklist items", 403);
  const { id } = await params;

  const body = await safeJson(request);
  const label: string | undefined = body?.label?.trim();
  if (!label) return err("label is required");

  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  const session = cookie ? decodeSession(decodeURIComponent(cookie.value)) : null;

  const sb = createServiceClient();
  // Append: one past the highest existing position for this card.
  const { data: last } = await sb
    .from("planner_item_checklist")
    .select("sort_order")
    .eq("item_id", id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await sb
    .from("planner_item_checklist")
    .insert({
      item_id: id,
      board_id: new URL(request.url).searchParams.get("board") || "default",
      label,
      created_by: session?.full_name || session?.email || "Unknown",
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id, label, done, done_at, done_by, created_by, created_at, sort_order")
    .single();
  if (error) return err(error.message, 400);
  return ok(data, 201);
}
