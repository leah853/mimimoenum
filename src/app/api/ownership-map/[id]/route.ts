import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";
import { canEditOwnerMaps } from "@/lib/roles";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  if (!canEditOwnerMaps(role)) return err("Forbidden: admin only", 403);
  const { id } = await params;
  const sb = createServiceClient();

  const { error } = await sb.from("ownership_map").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
