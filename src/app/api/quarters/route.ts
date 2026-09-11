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
    .select("id, name, start_date, end_date, breather_start, breather_end, iterations(id, quarter_id, name, iteration_number, start_date, end_date, is_breather, weeks(*))")
    .order("start_date", { ascending: false });

  if (error) return err(error.message, 500);
  return ok(data);
}
