import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { parseAndIngest } from "@/lib/csv-parser";
import { ok, err } from "@/lib/api-helpers";
import * as XLSX from "xlsx";

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) return err("No file provided");

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

    if (rawRows.length === 0) return err("File is empty or unreadable");

    const result = await parseAndIngest(supabase, rawRows);
    return ok(result);
  } catch (e) {
    return err(`Parse failed: ${e instanceof Error ? e.message : "Unknown error"}`, 500);
  }
}
