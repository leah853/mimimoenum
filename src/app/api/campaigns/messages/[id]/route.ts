import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";

function getCallerEmail(request: NextRequest): string | null {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  if (!cookie?.value) return null;
  const session = decodeSession(decodeURIComponent(cookie.value));
  return session?.email ?? null;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const email = getCallerEmail(request);
  if (!email) return err("Not authenticated", 401);

  const { id } = await params;
  const sb = createServiceClient();

  const { data: msg, error: readErr } = await sb
    .from("campaign_thread_messages")
    .select("id, author_email")
    .eq("id", id)
    .maybeSingle();

  if (readErr) return err(readErr.message, 500);
  if (!msg) return err("Message not found", 404);

  const isAdmin = role === "admin";
  const isAuthor = msg.author_email === email;
  if (!isAdmin && !isAuthor) {
    return err("Only the author or an admin can delete this message", 403);
  }

  const { error: delErr } = await sb
    .from("campaign_thread_messages")
    .delete()
    .eq("id", id);
  if (delErr) return err(delErr.message, 400);

  return ok({ ok: true });
}
