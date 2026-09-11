import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err, safeJson } from "@/lib/api-helpers";
import { getCallerRole, isDoerOrAdmin } from "@/lib/api-auth";
import { AUTH_COOKIE_NAME, decodeSession } from "@/lib/basic-auth";
import {
  defaultBoard,
  SYNC_BOUNDARY,
  CATEGORY_TO_ROW,
  type PlannerBoard,
  type PlannerItem,
} from "@/lib/planner-model";

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

  const stored = (data?.data as PlannerBoard | undefined) ?? defaultBoard();
  const withBreather = await withBreathers(sb, stored);
  const { board, syncContext } = await overlayTaskCells(sb, withBreather);

  if (!data) {
    return ok({
      board,
      persisted: true,
      updated_at: null,
      updated_by: null,
      syncBoundary: SYNC_BOUNDARY,
      syncContext,
    });
  }

  return ok({
    board,
    persisted: true,
    updated_at: data.updated_at,
    updated_by: data.updated_by,
    syncBoundary: SYNC_BOUNDARY,
    syncContext,
  });
}

interface IterationRow {
  id: string;
  quarter_id: string;
  iteration_number: number;
  start_date: string;
  weeks: { id: string; week_number: number }[];
}
interface QuarterRow { id: string; name: string; iterations: IterationRow[] }
interface TaskRow {
  id: string;
  title: string;
  status: string;
  category: string | null;
  deadline: string | null;
  iteration_id: string | null;
  week_id: string | null;
  quarter_id: string | null;
}

export interface PlannerSyncCell {
  quarterId: string;
  iterationId: string;
  weekId: string;
}

/**
 * From Q3 2026 Iteration 4 onward (iterations that start on/after
 * SYNC_BOUNDARY), the planner cells whose row_key maps to a task category
 * are sourced from the `tasks` table. Other cells (older iterations, or
 * rows without a category mapping) keep their JSON contents untouched.
 *
 * Returns the merged board plus a `syncContext` map from column key
 * (`qKey:iKey:wKey`) → the IDs the client needs to POST a task into that
 * cell.
 */
async function overlayTaskCells(
  sb: ReturnType<typeof createServiceClient>,
  board: PlannerBoard
): Promise<{ board: PlannerBoard; syncContext: Record<string, PlannerSyncCell> }> {
  // Fetch quarter/iteration/week metadata for the sync window. We match
  // planner labels (e.g. "Q3 2026" → key "q3-2026", iteration_number → "i3",
  // week_number → "w1") so the column key is deterministically reproducible.
  const { data: quarterRows, error: qErr } = await sb
    .from("quarters")
    .select("id, name, iterations(id, quarter_id, iteration_number, start_date, weeks(id, week_number))")
    .gte("iterations.start_date", SYNC_BOUNDARY);

  const syncContext: Record<string, PlannerSyncCell> = {};
  const cellIdByIterWeek = new Map<string, string>(); // "iterId|weekId" → column key

  if (qErr || !quarterRows) {
    return { board, syncContext };
  }

  for (const q of quarterRows as QuarterRow[]) {
    const qKey = q.name.toLowerCase().replace(/\s+/g, "-");
    for (const it of q.iterations ?? []) {
      if (!it.start_date || it.start_date < SYNC_BOUNDARY) continue;
      const iKey = `i${it.iteration_number}`;
      for (const w of it.weeks ?? []) {
        const wKey = `w${w.week_number}`;
        const colKey = `${qKey}:${iKey}:${wKey}`;
        syncContext[colKey] = { quarterId: q.id, iterationId: it.id, weekId: w.id };
        cellIdByIterWeek.set(`${it.id}|${w.id}`, colKey);
      }
    }
  }

  if (cellIdByIterWeek.size === 0) return { board, syncContext };

  // Pull only the tasks that fall inside the sync window and carry a mapped
  // category. Everything else is invisible to the planner.
  const iterIds = Array.from(new Set(
    Object.values(syncContext).map((c) => c.iterationId)
  ));
  const { data: taskRows, error: tErr } = await sb
    .from("tasks")
    .select("id, title, status, category, deadline, iteration_id, week_id, quarter_id")
    .in("iteration_id", iterIds);

  if (tErr || !taskRows) return { board, syncContext };

  const today = new Date().toISOString().slice(0, 10);
  const cells: Record<string, PlannerItem[]> = { ...board.cells };

  // For each synced column that has any task, replace the cell contents
  // (source of truth = tasks). JSON items for that cell are dropped —
  // owners see only the shared, DB-backed cards.
  const replaced = new Set<string>();
  for (const t of taskRows as TaskRow[]) {
    if (!t.iteration_id || !t.week_id) continue;
    const colKey = cellIdByIterWeek.get(`${t.iteration_id}|${t.week_id}`);
    if (!colKey) continue;
    const rowKey = t.category ? CATEGORY_TO_ROW[t.category] : undefined;
    if (!rowKey) continue;
    const cellKey = `${rowKey}|${colKey}`;
    if (!replaced.has(cellKey)) {
      cells[cellKey] = [];
      replaced.add(cellKey);
    }
    const overdue =
      !!t.deadline && t.deadline < today && t.status !== "completed";
    cells[cellKey].push({
      id: t.id,
      title: t.title,
      status: (t.status as PlannerItem["status"]) ?? "not_started",
      source: "task",
      overdue,
    });
  }

  // For synced rows/cols where the JSON had legacy content but there is no
  // matching task, empty the cell too — the JSON must not resurface once we
  // have declared this cell as tasks-owned. A row is "tasks-owned" whenever
  // its key is in CATEGORY_TO_ROW's values.
  const taskOwnedRowKeys = new Set(Object.values(CATEGORY_TO_ROW));
  for (const colKey of Object.keys(syncContext)) {
    for (const rowKey of taskOwnedRowKeys) {
      const cellKey = `${rowKey}|${colKey}`;
      if (!replaced.has(cellKey) && cells[cellKey]?.length) {
        delete cells[cellKey];
      }
    }
  }

  return { board: { ...board, cells }, syncContext };
}

/**
 * Overlay each board quarter with its "breather week" span, looked up from
 * the `quarters` table by matching `quarters.name` against `PlannerQuarter.label`
 * (e.g. "Q3 2026"). Purely additive — the stored JSON is untouched, so writes
 * continue to round-trip only what the client authors. Quarters without a
 * matching row, without breather dates, or when the table is absent, receive
 * `breather: null` and the frontend simply omits the column.
 */
async function withBreathers(
  sb: ReturnType<typeof createServiceClient>,
  board: PlannerBoard
): Promise<PlannerBoard> {
  const { data, error } = await sb
    .from("quarters")
    .select("name, breather_start, breather_end");

  if (error) {
    // Table missing (fresh env without the migration) or any other read
    // failure: quietly render without breather columns rather than failing
    // the whole board load.
    if (!isMissingTable(error, "quarters")) {
      console.error("planner: failed to read quarters breather columns", error.message);
    }
    return {
      ...board,
      quarters: (board.quarters ?? []).map((q) => ({ ...q, breather: null })),
    };
  }

  const byName = new Map<string, { start: string; end: string } | null>();
  for (const row of (data ?? []) as { name: string; breather_start: string | null; breather_end: string | null }[]) {
    byName.set(
      row.name,
      row.breather_start && row.breather_end
        ? { start: row.breather_start, end: row.breather_end }
        : null
    );
  }

  return {
    ...board,
    quarters: (board.quarters ?? []).map((q) => ({
      ...q,
      breather: byName.get(q.label) ?? null,
    })),
  };
}

export async function PUT(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  // Reps (@mimimomentum.com) review the plan; owners author it. The client
  // hides the editors for reps, but the rule is enforced here regardless.
  if (!isDoerOrAdmin(request)) return err("Only owners can edit the planner", 403);

  const body = await safeJson(request);
  if (!body?.board) return err("board required");

  const incoming = body.board as PlannerBoard;
  if (!Array.isArray(incoming.quarters) || !Array.isArray(incoming.rows) || typeof incoming.cells !== "object") {
    return err("Malformed board: expected quarters, rows and cells");
  }

  // Task-sourced items are projections, never stored in the board JSON.
  // Strip them before persisting so the JSON stays authoritative only for
  // legacy / unmapped cells.
  const cleanedCells: Record<string, PlannerItem[]> = {};
  for (const [k, list] of Object.entries(incoming.cells ?? {})) {
    const kept = (list ?? []).filter((i) => i && i.source !== "task");
    if (kept.length) {
      // Also strip transient overdue flag — that is server-computed on read.
      cleanedCells[k] = kept.map(({ overdue: _o, source: _s, ...rest }) => {
        void _o; void _s;
        return rest as PlannerItem;
      });
    }
  }
  const board: PlannerBoard = { ...incoming, cells: cleanedCells };

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
      const other = current.updated_by;
      const sameAccount = other && other === callerEmail(request);
      return err(
        sameAccount
          ? "This planner was changed in another tab or window. Reload to pick up those changes before editing here."
          : `This planner was changed by ${other ?? "someone else"} while you had it open. Reload to pick up their changes before editing.`,
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
