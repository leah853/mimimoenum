import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";

interface AttachmentInput {
  kind: "file" | "link" | "text";
  file_url?: string;
  file_name?: string;
  link_url?: string;
  text_body?: string;
  size_bytes?: number;
}

function getCallerEmail(request: NextRequest): string | null {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  if (!cookie?.value) return null;
  const session = decodeSession(decodeURIComponent(cookie.value));
  return session?.email ?? null;
}

export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  if (role !== "doer" && role !== "admin") {
    return err("Only @eonexea owners can submit versions", 403);
  }

  const email = getCallerEmail(request);
  if (!email) return err("Not authenticated", 401);

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  const nodeId: string | undefined = body.node_id;
  const attachments: AttachmentInput[] = Array.isArray(body.attachments) ? body.attachments : [];
  if (!nodeId) return err("node_id required");
  if (attachments.length === 0) return err("At least one attachment required");

  for (const a of attachments) {
    if (!a || !a.kind) return err("Each attachment needs a kind");
    if (a.kind === "file" && !a.file_url) return err("File attachment needs file_url");
    if (a.kind === "link" && !a.link_url) return err("Link attachment needs link_url");
    if (a.kind === "text" && !a.text_body) return err("Text attachment needs text_body");
  }

  const sb = createServiceClient();

  // Confirm node exists and is a leaf (no channel children).
  const { data: node, error: nodeErr } = await sb
    .from("campaign_nodes")
    .select("id, kind")
    .eq("id", nodeId)
    .maybeSingle();
  if (nodeErr) return err(nodeErr.message, 500);
  if (!node) return err("Node not found", 404);

  const { data: kids, error: kidsErr } = await sb
    .from("campaign_nodes")
    .select("id")
    .eq("parent_id", nodeId)
    .limit(1);
  if (kidsErr) return err(kidsErr.message, 500);
  if (kids && kids.length > 0) return err("Node is not a leaf", 400);

  // Latest submission — reject if already GO (locked).
  const { data: latest, error: latestErr } = await sb
    .from("campaign_submissions")
    .select("version_number, decision")
    .eq("node_id", nodeId)
    .order("version_number", { ascending: false })
    .limit(1);
  if (latestErr) return err(latestErr.message, 500);

  if (latest && latest.length > 0 && latest[0].decision === "go") {
    return err("Leaf is locked — the latest submission is already GO", 409);
  }

  const nextVersion = latest && latest.length > 0 ? latest[0].version_number + 1 : 1;

  const { data: sub, error: subErr } = await sb
    .from("campaign_submissions")
    .insert({
      node_id: nodeId,
      version_number: nextVersion,
      uploaded_by: email,
    })
    .select()
    .single();
  if (subErr) return err(subErr.message, 400);

  const attachRows = attachments.map((a) => ({
    submission_id: sub.id,
    kind: a.kind,
    file_url: a.file_url ?? null,
    file_name: a.file_name ?? null,
    link_url: a.link_url ?? null,
    text_body: a.text_body ?? null,
    size_bytes: a.size_bytes ?? null,
  }));

  const { error: attErr } = await sb.from("campaign_submission_attachments").insert(attachRows);
  if (attErr) {
    // Roll back the submission so we don't leave a partial version behind.
    await sb.from("campaign_submissions").delete().eq("id", sub.id);
    return err(attErr.message, 400);
  }

  return ok(sub, 201);
}
