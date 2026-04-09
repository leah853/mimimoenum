import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole, getCallerId } from "@/lib/api-auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;
  const sb = createServiceClient();

  // Ownership check: only the uploader or admin can edit
  if (role !== "admin") {
    const callerId = await getCallerId(request);
    const { data: record } = await sb.from("deliverables").select("uploaded_by").eq("id", id).single();
    if (!record || record.uploaded_by !== callerId) {
      return err("Forbidden: you can only edit your own deliverables", 403);
    }
  }

  const body = await request.json();

  if (body.viewed === true && !body.viewed_at) {
    body.viewed_at = new Date().toISOString();
  }

  const { data, error } = await sb.from("deliverables").update(body).eq("id", id).select().single();
  if (error) return err(error.message, 400);
  return ok(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  const { id } = await params;
  const sb = createServiceClient();

  // Ownership check: only the uploader or admin can delete
  if (role !== "admin") {
    const callerId = await getCallerId(request);
    const { data: record } = await sb.from("deliverables").select("uploaded_by").eq("id", id).single();
    if (!record || record.uploaded_by !== callerId) {
      return err("Forbidden: you can only delete your own deliverables", 403);
    }
  }

  const { error } = await sb.from("deliverables").delete().eq("id", id);
  if (error) return err(error.message, 400);
  return ok({ deleted: true });
}
