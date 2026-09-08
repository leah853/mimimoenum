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
  if (role !== "assessor") {
    return err("Only @mimimomentum reps can decide GO / NO-GO", 403);
  }

  const email = getCallerEmail(request);
  if (!email) return err("Not authenticated", 401);

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  const submissionId: string | undefined = body.submission_id;
  const decision: "go" | "no_go" | undefined = body.decision;
  const feedback: string | undefined = body.feedback;

  if (!submissionId) return err("submission_id required");
  if (decision !== "go" && decision !== "no_go") return err("decision must be 'go' or 'no_go'");

  const sb = createServiceClient();

  const { data: updated, error } = await sb
    .from("campaign_submissions")
    .update({
      decision,
      decided_by: email,
      decided_at: new Date().toISOString(),
      feedback: feedback ?? null,
    })
    .eq("id", submissionId)
    .select()
    .single();

  if (error) return err(error.message, 400);
  return ok(updated);
}
