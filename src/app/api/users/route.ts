import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";

export async function GET() {
  const sb = createServiceClient();
  const { data, error } = await sb.from("users").select("id, full_name, email, role").order("full_name");
  if (error) return err(error.message, 500);
  return ok(data);
}
