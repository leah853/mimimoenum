import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { v4 as uuidv4 } from "uuid";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const formData = await request.formData();

  const file = formData.get("file") as File;
  const taskId = formData.get("task_id") as string;
  const subtaskId = formData.get("subtask_id") as string;
  const title = formData.get("title") as string;
  const uploadedBy = formData.get("uploaded_by") as string;

  if (!file) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }

  const ext = file.name.split(".").pop();
  const path = `deliverables/${uuidv4()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("deliverables")
    .upload(path, file);

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("deliverables").getPublicUrl(path);

  // Get latest version
  const targetCol = taskId ? "task_id" : "subtask_id";
  const targetId = taskId || subtaskId;

  const { data: existing } = await supabase
    .from("deliverables")
    .select("version")
    .eq(targetCol, targetId)
    .order("version", { ascending: false })
    .limit(1);

  const version = existing && existing.length > 0 ? existing[0].version + 1 : 1;

  const { data, error } = await supabase
    .from("deliverables")
    .insert({
      task_id: taskId || null,
      subtask_id: subtaskId || null,
      title: title || file.name,
      file_url: publicUrl,
      version,
      uploaded_by: uploadedBy || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
