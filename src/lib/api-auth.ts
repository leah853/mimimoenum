import { NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";
import { detectRole, type AppRole } from "@/lib/roles";

/**
 * Extract the caller's role from the auth cookie.
 * Returns null if not authenticated.
 */
export function getCallerRole(request: NextRequest): AppRole | null {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  if (!cookie?.value) return null;
  const session = decodeSession(decodeURIComponent(cookie.value));
  if (!session) return null;
  return detectRole(session.email);
}

export function isDoerOrAdmin(request: NextRequest): boolean {
  const role = getCallerRole(request);
  return role === "doer" || role === "admin";
}

export function isAssessor(request: NextRequest): boolean {
  const role = getCallerRole(request);
  return role === "assessor";
}

export async function getCallerId(request: NextRequest): Promise<string | null> {
  const role = getCallerRole(request);
  if (!role) return null;
  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  if (!cookie?.value) return null;
  const session = decodeSession(decodeURIComponent(cookie.value));
  if (!session?.email) return null;

  try {
    const { createServiceClient } = require("@/lib/supabase/server");
    const sb = createServiceClient();
    const { data } = await sb.from("users").select("id").eq("email", session.email).maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}
