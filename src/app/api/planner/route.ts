import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, isDoerOrAdmin } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";
import { defaultBoard, type PlannerBoard } from "@/lib/planner-model";

const DEFAULT_BOARD_ID = "default";

/**
 * True when the planner_boards table has not been created yet.
 *
 * Two spellings matter: PostgREST answers an unknown table with PGRST205
 * ("Could not find the table ... in the schema cache") before the query ever
 * reaches Postgres, while a direct SQL path surfaces Postgres's own 42P01
 * ("relation does not exist"). Match both.
 */
function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  const message = error.message ?? "";
  return /planner_boards/.test(message) && /(does not exist|could not find the table)/i.test(message);
}

function boardId(request: NextRequest) {
  return new URL(request.url).searchParams.get("board") || DEFAULT_BOARD_ID;
}

export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const sb = createServiceClient();
  const id = boardId(request);

  const { data, error } = await sb
    .from("planner_boards")
    .select("id, data, updated_at, updated_by")
    .eq("id", id)
    .maybeSingle();

  // The board table is created by supabase/migrations/20260824_planner_board.sql.
  // Until that runs, hand back the starting board and tell the client that
  // nothing will persist server-side, so it can say so rather than silently
  // dropping the user's edits.
  if (error && isMissingTable(error)) {
    return ok({ board: defaultBoard(), persisted: false, updated_at: null, updated_by: null });
  }
  if (error) return err(error.message, 500);

  if (!data) {
    return ok({ board: defaultBoard(), persisted: true, updated_at: null, updated_by: null });
  }

  return ok({
    board: data.data as PlannerBoard,
    persisted: true,
    updated_at: data.updated_at,
    updated_by: data.updated_by,
  });
}

export async function PUT(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  // Reps (@mimimomentum.com) review the plan; owners author it. The client
  // hides the editors for reps, but the rule is enforced here regardless.
  if (!isDoerOrAdmin(request)) return err("Only owners can edit the planner", 403);

  const body = await safeJson(request);
  if (!body?.board) return err("board required");

  const board = body.board as PlannerBoard;
  if (!Array.isArray(board.quarters) || !Array.isArray(board.rows) || typeof board.cells !== "object") {
    return err("Malformed board: expected quarters, rows and cells");
  }

  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  const session = cookie?.value ? decodeSession(decodeURIComponent(cookie.value)) : null;

  const sb = createServiceClient();
  const { data, error } = await sb
    .from("planner_boards")
    .upsert({ id: boardId(request), data: board, updated_by: session?.email ?? null }, { onConflict: "id" })
    .select("updated_at, updated_by")
    .single();

  if (error && isMissingTable(error)) {
    return err(
      "The planner_boards table does not exist yet. Run supabase/migrations/20260824_planner_board.sql in the Supabase SQL editor.",
      503
    );
  }
  if (error) return err(error.message, 400);

  return ok({ saved: true, updated_at: data.updated_at, updated_by: data.updated_by });
}
