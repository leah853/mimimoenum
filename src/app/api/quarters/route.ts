import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";

export async function GET() {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("quarters")
    .select("*, iterations(*, weeks(*))")
    .order("start_date", { ascending: false });

  if (error) return err(error.message, 500);
  return ok(data);
}
