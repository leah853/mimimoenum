import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";

function getCallerEmail(request: NextRequest): string | null {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  if (!cookie?.value) return null;
  const session = decodeSession(decodeURIComponent(cookie.value));
  return session?.email ?? null;
}

export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const email = getCallerEmail(request);
  if (!email) return err("Not authenticated", 401);

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  const nodeId: string | undefined = body.node_id;
  const submissionId: string | undefined = body.submission_id;
  const text: string | undefined = typeof body.body === "string" ? body.body : undefined;

  if (!nodeId) return err("node_id required");
  if (!text || !text.trim()) return err("body required");

  const authorRole: "owner" | "rep" | "admin" =
    role === "assessor" ? "rep" : role === "admin" ? "admin" : "owner";

  const sb = createServiceClient();

  // Confirm node exists.
  const { data: node, error: nodeErr } = await sb
    .from("campaign_nodes")
    .select("id")
    .eq("id", nodeId)
    .maybeSingle();
  if (nodeErr) return err(nodeErr.message, 500);
  if (!node) return err("Node not found", 404);

  const { data: msg, error: msgErr } = await sb
    .from("campaign_thread_messages")
    .insert({
      node_id: nodeId,
      submission_id: submissionId ?? null,
      author_email: email,
      author_role: authorRole,
      body: text.trim(),
    })
    .select()
    .single();

  if (msgErr) return err(msgErr.message, 400);
  return ok(msg, 201);
}
