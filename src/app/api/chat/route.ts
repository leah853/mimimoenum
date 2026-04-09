import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

// Ensure general_chat table exists
async function ensureTable(sb: ReturnType<typeof createServiceClient>) {
  // Try a simple select — if it fails, create the table
  const { error } = await sb.from("general_chat").select("id").limit(1);
  if (error?.code === "PGRST205" || error?.code === "42P01") {
    // Table doesn't exist — create via raw SQL using pg_net or RPC isn't available,
    // so we use a workaround: create via the service client's direct query capability
    // Actually, Supabase JS doesn't support raw SQL. We'll create via the REST API.
    // For now, return a flag to indicate table doesn't exist
    return false;
  }
  return true;
}

export async function GET(request: NextRequest) {
  const sb = createServiceClient();
  const tableExists = await ensureTable(sb);
  if (!tableExists) return ok([]);

  const { data, error } = await sb
    .from("general_chat")
    .select("*, user:users!general_chat_user_id_fkey(id, full_name, email)")
    .order("created_at", { ascending: true });

  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const sb = createServiceClient();
  const tableExists = await ensureTable(sb);
  if (!tableExists) return err("Chat table not initialized. Please create the general_chat table in Supabase.", 500);

  const body = await request.json();
  const { user_id, message, mentions, parent_id } = body;

  if (!user_id || !message) return err("user_id and message required");

  const { data, error } = await sb
    .from("general_chat")
    .insert({
      user_id,
      message,
      mentions: mentions || [],
      parent_id: parent_id || null,
    })
    .select("*, user:users!general_chat_user_id_fkey(id, full_name, email)")
    .single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}
