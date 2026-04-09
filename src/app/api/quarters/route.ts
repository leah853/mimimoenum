import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("quarters")
    .select("*, iterations(*, weeks(*))")
    .order("start_date", { ascending: false });

  if (error) return err(error.message, 500);
  return ok(data);
}
