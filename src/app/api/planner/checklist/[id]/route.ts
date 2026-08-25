import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, isDoerOrAdmin } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";

/**
 * Tick an item off (or back on). Deliberately open to any authenticated user,
 * including reps: the checklist tracks ops support that either side may
 * complete, and the trail is where that gets marked.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;

  const body = await safeJson(request);
  if (typeof body?.done !== "boolean") return err("done (boolean) is required");

  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  const session = cookie ? decodeSession(decodeURIComponent(cookie.value)) : null;
  const who = session?.full_name || session?.email || "Unknown";

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("planner_item_checklist")
    .update(
      body.done
        ? { done: true, done_at: new Date().toISOString(), done_by: who }
        : { done: false, done_at: null, done_by: null }
    )
    .eq("id", id)
    .select("id, label, done, done_at, done_by, created_by, created_at")
    .single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  if (!isDoerOrAdmin(request)) return err("Only owners can remove checklist items", 403);
  const { id } = await params;

  const sb = createServiceClient();
  const { error } = await sb.from("planner_item_checklist").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
