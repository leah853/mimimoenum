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
  const hasFeedback = Object.prototype.hasOwnProperty.call(body, "feedback");
  const feedback: string | null | undefined = hasFeedback ? (body.feedback ?? null) : undefined;
  const hasScore = Object.prototype.hasOwnProperty.call(body, "score");
  const rawScore: unknown = body.score;

  if (!submissionId) return err("submission_id required");

  let score: number | null | undefined = undefined;
  if (hasScore) {
    if (rawScore === null) {
      score = null;
    } else if (typeof rawScore !== "number" || !Number.isInteger(rawScore) || rawScore < 1 || rawScore > 10) {
      return err("score must be an integer between 1 and 10");
    } else {
      score = rawScore;
    }
  }

  const sb = createServiceClient();

  // Fetch existing to know whether this is an initial decision or an update.
  const { data: existing, error: fetchErr } = await sb
    .from("campaign_submissions")
    .select("id, node_id, decision")
    .eq("id", submissionId)
    .single();
  if (fetchErr || !existing) return err("submission not found", 404);

  const isUpdate = existing.decision === "go" || existing.decision === "no_go";

  if (!isUpdate) {
    if (decision !== "go" && decision !== "no_go") {
      return err("decision must be 'go' or 'no_go'");
    }
  } else if (decision !== undefined && decision !== "go" && decision !== "no_go") {
    return err("decision must be 'go' or 'no_go'");
  }

  const patch: Record<string, unknown> = {};
  if (decision !== undefined) {
    patch.decision = decision;
    patch.decided_by = email;
    patch.decided_at = new Date().toISOString();
  } else if (!isUpdate) {
    // Guarded above; keep TS happy.
    return err("decision required");
  }
  if (hasFeedback) patch.feedback = feedback;
  if (hasScore) patch.score = score;
  // On initial creation, ensure feedback/score default to null if not provided
  // (preserve prior behavior).
  if (!isUpdate) {
    if (!hasFeedback) patch.feedback = null;
    if (!hasScore) patch.score = null;
  }

  const { data: updated, error } = await sb
    .from("campaign_submissions")
    .update(patch)
    .eq("id", submissionId)
    .select()
    .single();

  if (error) return err(error.message, 400);

  // Mirror score/feedback into the thread as a rep message.
  const finalScore: number | null = (updated?.score ?? null) as number | null;
  const finalFeedback: string = ((updated?.feedback as string | null) ?? "").trim();
  const bodyText = finalScore !== null
    ? (finalFeedback ? `${finalScore}/10 — ${finalFeedback}` : `${finalScore}/10`)
    : finalFeedback;

  const { data: existingMsgs } = await sb
    .from("campaign_thread_messages")
    .select("id")
    .eq("submission_id", submissionId)
    .limit(1);

  if (existingMsgs && existingMsgs.length > 0) {
    if (bodyText) {
      await sb
        .from("campaign_thread_messages")
        .update({ body: bodyText })
        .eq("id", existingMsgs[0].id);
    } else {
      // Nothing to say anymore; remove the auto message.
      await sb
        .from("campaign_thread_messages")
        .delete()
        .eq("id", existingMsgs[0].id);
    }
  } else if (bodyText && updated) {
    await sb.from("campaign_thread_messages").insert({
      node_id: updated.node_id,
      submission_id: submissionId,
      author_email: email,
      author_role: "rep",
      body: bodyText,
    });
  }

  return ok(updated);
}
