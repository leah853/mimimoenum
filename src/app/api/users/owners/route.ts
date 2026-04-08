import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";

// Only returns task-assignable owners (Leah + Chloe)
const OWNER_EMAILS = ["leah@eonexea.com", "chloe@eonexea.com"];

export async function GET() {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("users")
    .select("id, full_name, email")
    .in("email", OWNER_EMAILS)
    .order("full_name");
  if (error) return err(error.message, 500);
  return ok(data);
}
