import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";

/**
 * Comment thread on one planner card. Mirrors the milestone-node feedback
 * route: any authenticated user may read and post, because feedback is the
 * one thing reps are here to do even though the plan itself is read-only
 * to them.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("planner_item_feedback")
    .select("id, author, body, created_at, owner_id")
    .eq("item_id", id)
    .order("created_at", { ascending: true });
  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const callerId = await getCallerId(request);
  if (!callerId) return err("Could not verify identity", 401);
  const { id } = await params;

  const body = await safeJson(request);
  if (!body?.body?.trim()) return err("body is required");

  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  const session = cookie ? decodeSession(decodeURIComponent(cookie.value)) : null;
  const author = body.author || session?.full_name || session?.email || "Unknown";

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("planner_item_feedback")
    .insert({
      item_id: id,
      board_id: new URL(request.url).searchParams.get("board") || "default",
      owner_id: callerId,
      author,
      body: body.body.trim(),
    })
    .select("id, author, body, created_at, owner_id")
    .single();
  if (error) return err(error.message, 400);
  return ok(data, 201);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const callerId = await getCallerId(request);
  const commentId = new URL(request.url).searchParams.get("comment");
  if (!commentId) return err("comment id required");
  const { id } = await params;

  const sb = createServiceClient();
  // Authors delete their own comments; admins can delete any.
  let query = sb.from("planner_item_feedback").delete().eq("id", commentId).eq("item_id", id);
  if (role !== "admin") query = query.eq("owner_id", callerId ?? "");

  const { error } = await query;
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
