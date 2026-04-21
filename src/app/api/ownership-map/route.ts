import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";
import { isAreaSlug } from "@/lib/functional-areas";
import { canEditOwnerMaps } from "@/lib/roles";

const SELECT_WITH_OWNERS = `
  id, entity_type, entity_id, primary_owner_user_id, secondary_owner_user_id, updated_at, created_at,
  primary_owner:users!ownership_map_primary_owner_user_id_fkey(id, full_name, email),
  secondary_owner:users!ownership_map_secondary_owner_user_id_fkey(id, full_name, email)
`;

export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const sb = createServiceClient();
  const entityType = new URL(request.url).searchParams.get("entity_type");

  let q = sb.from("ownership_map").select(SELECT_WITH_OWNERS);
  if (entityType === "AREA" || entityType === "MILESTONE") q = q.eq("entity_type", entityType);

  const { data, error } = await q;
  if (error) return err(error.message, 500);
  return ok(data || []);
}

export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  if (!canEditOwnerMaps(role)) return err("Forbidden: admin only", 403);

  const body = await safeJson(request);
  if (!body) return err("Invalid JSON", 400);

  const { entity_type, entity_id, primary_owner_user_id, secondary_owner_user_id } = body as {
    entity_type?: string;
    entity_id?: string;
    primary_owner_user_id?: string;
    secondary_owner_user_id?: string | null;
  };

  if (entity_type !== "AREA" && entity_type !== "MILESTONE") return err("Invalid entity_type");
  if (!entity_id) return err("entity_id required");
  if (!primary_owner_user_id) return err("primary_owner_user_id required");

  const secondary = secondary_owner_user_id || null;
  if (secondary && secondary === primary_owner_user_id) {
    return err("Primary and secondary owner must differ", 422);
  }

  const sb = createServiceClient();

  // Validate referenced entity exists
  if (entity_type === "AREA") {
    if (!isAreaSlug(entity_id)) return err("Unknown area slug", 404);
  } else {
    const { data: m } = await sb.from("quarter_goals").select("id").eq("id", entity_id).maybeSingle();
    if (!m) return err("Milestone not found", 404);
  }

  // Validate owners exist
  const ownerIds = [primary_owner_user_id, secondary].filter(Boolean) as string[];
  const { data: foundUsers } = await sb.from("users").select("id").in("id", ownerIds);
  if ((foundUsers?.length || 0) !== ownerIds.length) return err("Owner user not found", 404);

  // Upsert on (entity_type, entity_id)
  const { data, error } = await sb
    .from("ownership_map")
    .upsert(
      {
        entity_type,
        entity_id,
        primary_owner_user_id,
        secondary_owner_user_id: secondary,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entity_type,entity_id" },
    )
    .select(SELECT_WITH_OWNERS)
    .single();

  if (error) return err(error.message, 400);
  return ok(data, 201);
}
