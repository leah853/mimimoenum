import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createServiceClient();
  const body = await request.json();

  // If acknowledging, set timestamp
  if (body.acknowledged === true && !body.acknowledged_at) {
    body.acknowledged_at = new Date().toISOString();
  }

  const { data, error } = await sb.from("feedback").update(body).eq("id", id).select().single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createServiceClient();
  const { error } = await sb.from("feedback").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
