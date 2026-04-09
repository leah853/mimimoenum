import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;
  const sb = createServiceClient();
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

  const { error } = await sb.from("general_chat").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
