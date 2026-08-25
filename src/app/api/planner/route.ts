import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, isDoerOrAdmin } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";
import { defaultBoard, type PlannerBoard } from "@/lib/planner-model";

const DEFAULT_BOARD_ID = "default";
/** Versions retained per board. Older ones are pruned on write. */
const KEEP_VERSIONS = 30;

interface VersionRow { id: number; saved_at: string; saved_by: string | null; data: unknown }
/**
 * A save that empties a board holding at least this much content is treated as
 * a mistake, not an edit. Deletions happen one card at a time, so a legitimate
 * save never drops this many items at once — but a stale tab or a buggy client
 * posting a fresh default board does exactly that.
 */
const WIPE_GUARD_THRESHOLD = 5;

function isMissingTable(error: { code?: string; message?: string } | null, table: string) {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  const message = error.message ?? "";
  return new RegExp(table).test(message) && /(does not exist|could not find the table)/i.test(message);
}

function boardId(request: NextRequest) {
  return new URL(request.url).searchParams.get("board") || DEFAULT_BOARD_ID;
}

/** Total authored items on a board: every goal plus every week-cell card. */
function contentUnits(board: PlannerBoard): number {
  const goals = (board.quarters ?? []).reduce(
    (sum, q) => sum + (q.iterations ?? []).reduce((s, it) => s + (it.goals?.length ?? 0), 0),
    0
  );
  const cells = Object.values(board.cells ?? {}).reduce((sum, list) => sum + (list?.length ?? 0), 0);
  return goals + cells;
}

function callerEmail(request: NextRequest) {
  const cookie = request.cookies.get(AUTH_COOKIE_NAME);
  if (!cookie?.value) return null;
  return decodeSession(decodeURIComponent(cookie.value))?.email ?? null;
}

export async function GET(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);

  const sb = createServiceClient();
  const id = boardId(request);
  const { searchParams } = new URL(request.url);

  // ?versions=1 lists recoverable snapshots, newest first.
  if (searchParams.get("versions")) {
    const { data, error } = await sb
      .from("planner_board_versions")
      .select("id, saved_at, saved_by, data")
      .eq("board_id", id)
      .order("saved_at", { ascending: false })
      .limit(KEEP_VERSIONS);

    if (error && isMissingTable(error, "planner_board_versions")) return ok({ versions: [], available: false });
    if (error) return err(error.message, 500);

    return ok({
      available: true,
      versions: ((data ?? []) as VersionRow[]).map((v) => ({
        id: v.id,
        saved_at: v.saved_at,
        saved_by: v.saved_by,
        items: contentUnits(v.data as PlannerBoard),
      })),
    });
  }

  const { data, error } = await sb
    .from("planner_boards")
    .select("id, data, updated_at, updated_by")
    .eq("id", id)
    .maybeSingle();

  if (error && isMissingTable(error, "planner_boards")) {
    return ok({ board: defaultBoard(), persisted: false, updated_at: null, updated_by: null });
  }
  if (error) return err(error.message, 500);

  if (!data) return ok({ board: defaultBoard(), persisted: true, updated_at: null, updated_by: null });

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

  const sb = createServiceClient();
  const id = boardId(request);
  // Whether this write is rollback-able. Reported so the client can say when
  // history has silently degraded rather than pretending everything is safe.
  let versioned = true;

  const { data: current, error: readError } = await sb
    .from("planner_boards")
    .select("data, updated_at, updated_by")
    .eq("id", id)
    .maybeSingle();

  if (readError && isMissingTable(readError, "planner_boards")) {
    return err(
      "The planner_boards table does not exist yet. Run supabase/migrations/20260824_planner_board.sql in the Supabase SQL editor.",
      503
    );
  }
  if (readError) return err(readError.message, 500);

  if (current) {
    // ── Concurrency: refuse to overwrite a board that moved underneath us ──
    // The client sends the updated_at it last saw. A mismatch means someone
    // else (or another tab) saved in between, and blindly upserting would
    // silently discard their work.
    const base = body.baseUpdatedAt as string | undefined;
    if (base !== undefined && base !== current.updated_at) {
      return err(
        `This planner was changed by ${current.updated_by ?? "someone else"} while you had it open. Reload to pick up their changes before editing.`,
        409
      );
    }

    // ── Wipe guard ────────────────────────────────────────────────────────
    const before = contentUnits(current.data as PlannerBoard);
    const after = contentUnits(board);
    if (before >= WIPE_GUARD_THRESHOLD && after === 0 && !body.allowWipe) {
      return err(
        `Refusing to save: this would delete all ${before} items on the planner at once. If that is really intended, resend with allowWipe.`,
        409
      );
    }

    // ── Snapshot the outgoing state before replacing it ───────────────────
    // Best-effort: a board that cannot be versioned is still worth saving, so
    // failures here are logged rather than blocking the write.
    const { error: versionError } = await sb
      .from("planner_board_versions")
      .insert({ board_id: id, data: current.data, saved_by: current.updated_by });
    if (versionError) {
      versioned = false;
      console.error("planner: failed to record version", versionError.message);
    }
  }

  const { data, error } = await sb
    .from("planner_boards")
    .upsert({ id, data: board, updated_by: callerEmail(request) }, { onConflict: "id" })
    .select("updated_at, updated_by")
    .single();

  if (error) return err(error.message, 400);

  // Prune old snapshots outside the retention window.
  const { data: stale } = await sb
    .from("planner_board_versions")
    .select("id")
    .eq("board_id", id)
    .order("saved_at", { ascending: false })
    .range(KEEP_VERSIONS, KEEP_VERSIONS + 200);
  if (stale?.length) {
    await sb.from("planner_board_versions").delete().in("id", (stale as { id: number }[]).map((row) => row.id));
  }

  return ok({ saved: true, versioned, updated_at: data.updated_at, updated_by: data.updated_by });
}
