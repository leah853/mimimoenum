import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";
import { cellKey, flattenColumns, type PlannerBoard } from "@/lib/planner-model";

interface ChecklistRow {
  id: string;
  item_id: string;
  label: string;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  created_by: string;
  created_at: string;
}

/**
 * Every checklist item on a board, with each one resolved back to the card it
 * came from. Cards live inside planner_boards.data as JSONB, so the location
 * cannot be joined in SQL — the board is read once and turned into a lookup.
 *
 * Feeds the Feedback Trail's Ops Checklist tab.
 */
export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const sb = createServiceClient();
  const boardId = new URL(request.url).searchParams.get("board") || "default";

  const { data: rows, error } = await sb
    .from("planner_item_checklist")
    .select("id, item_id, label, done, done_at, done_by, created_by, created_at")
    .eq("board_id", boardId)
    .order("created_at", { ascending: false });

  if (error) {
    // The table arrives with 20260825_planner_item_checklist.sql. Until then
    // the tab should render empty rather than error.
    if (error.code === "PGRST205" || error.code === "42P01") return ok({ available: false, items: [] });
    return err(error.message, 500);
  }
  if (!rows?.length) return ok({ available: true, items: [] });

  const { data: boardRow } = await sb.from("planner_boards").select("data").eq("id", boardId).maybeSingle();
  const board = boardRow?.data as PlannerBoard | undefined;

  // item uuid -> where it sits on the grid.
  const where = new Map<string, { task: string; row: string; when: string }>();
  if (board) {
    const columns = flattenColumns(board);
    for (const row of board.rows) {
      if (row.kind === "section") continue;
      for (const col of columns) {
        for (const item of board.cells[cellKey(row.key, col.key)] ?? []) {
          where.set(item.id, {
            task: item.title || "Untitled",
            row: row.label || "Untitled row",
            when: `${col.quarter.label} ${col.iteration.label} ${col.week.label}`,
          });
        }
      }
    }
  }

  return ok({
    available: true,
    items: (rows as ChecklistRow[]).map((r) => ({
      ...r,
      // A card deleted after its checklist items were created leaves them
      // without a home; surface them rather than dropping them silently.
      context: where.get(r.item_id) ?? { task: "(deleted task)", row: "—", when: "—" },
    })),
  });
}
