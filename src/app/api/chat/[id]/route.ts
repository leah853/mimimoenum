import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;
  const sb = createServiceClient();

  // Ownership check: only the message author or admin can edit
  if (role !== "admin") {
    const callerId = await getCallerId(request);
    if (!callerId) return err("Could not verify identity", 401);
    const { data: record } = await sb.from("general_chat").select("user_id").eq("id", id).single();
    if (!record || record.user_id !== callerId) {
      return err("Forbidden: you can only edit your own messages", 403);
    }
  }

  const body = await request.json();

  const { data, error } = await sb.from("general_chat").update({ message: body.message }).eq("id", id).select().single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;
  const sb = createServiceClient();

  // Ownership check: only the message author or admin can delete
  if (role !== "admin") {
    const callerId = await getCallerId(request);
    if (!callerId) return err("Could not verify identity", 401);
    const { data: record } = await sb.from("general_chat").select("user_id").eq("id", id).single();
    if (!record || record.user_id !== callerId) {
      return err("Forbidden: you can only delete your own messages", 403);
    }
  }

  const { error } = await sb.from("general_chat").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
