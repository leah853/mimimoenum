import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("milestone_node_feedback")
    .select("*")
    .eq("node_id", id)
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
  if (!body || !body.body) return err("body is required");

  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  const session = cookie ? decodeSession(decodeURIComponent(cookie.value)) : null;
  const author = body.author || session?.full_name || "Unknown";

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("milestone_node_feedback")
    .insert({ node_id: id, owner_id: callerId, author, body: body.body })
    .select()
    .single();
  if (error) return err(error.message, 400);
  return ok(data, 201);
}
