"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import PlannerGrid from "@/components/PlannerGrid";
import PlannerItemPanel from "@/components/PlannerItemPanel";
import { useAuth } from "@/lib/auth-context";
import { canEditTasks } from "@/lib/roles";
import {
  defaultBoard,
  flattenColumns,
  normalizeBoard,
  type PlannerBoard,
  type PlannerItem,
} from "@/lib/planner-model";

interface BoardResponse {
  board: PlannerBoard;
  persisted: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

type SaveState =
  | { kind: "idle" | "saving" }
  | { kind: "saved"; versioned: boolean }
  | { kind: "error"; message: string; attempts: number }
  /** Someone else saved while we had the board open; local edits are unsafe. */
  | { kind: "conflict"; message: string };

const SAVE_DEBOUNCE_MS = 900;

/** Rows whose Owner field is a picker rather than free text. */
const OWNER_CHOICES: Record<string, string[]> = {
  prerequisites: ["Leah", "Chloe"],
};

/** A card lives either in a week cell or in an iteration's goal list. */
type Selection =
  | { kind: "cell"; cell: string; itemId: string }
  | { kind: "goal"; quarterKey: string; iterationKey: string; itemId: string };

function statusText(readOnly: boolean, kind: SaveState["kind"]) {
  if (readOnly) return "Read-only";
  if (kind === "saving") return "Saving…";
  if (kind === "saved") return "All changes saved";
  if (kind === "conflict") return "Not saved";
  if (kind === "error") return "Not saved — retrying";
  return "";
}

export default function PlannerPage() {
  // Reps (@mimimomentum.com) review the plan; owners author it. Mirrors the
  // task-editing rule, and /api/planner enforces the same check server-side.
  const { appRole } = useAuth();
  const readOnly = !canEditTasks(appRole);

  // ?board=<id> selects a different planner document. The live plan is
  // "default"; anything else is a sandbox, which is how this page gets
  // exercised without writing to real data.
  // Read via useSyncExternalStore rather than lazy state: the server has no
  // query string, so hydration must start from the server's answer (null) and
  // only then adopt the client's. A plain initializer diverges and trips a
  // hydration mismatch.
  const boardParam = useSyncExternalStore(
    () => () => {},
    () => {
      const value = new URLSearchParams(window.location.search).get("board");
      return value && /^[a-z0-9-]{1,60}$/i.test(value) ? value : null;
    },
    () => null
  );
  const api = boardParam ? `/api/planner?board=${encodeURIComponent(boardParam)}` : "/api/planner";

  const [board, setBoard] = useState<PlannerBoard | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(true);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against an in-flight save overwriting a newer edit: only the most
  // recent scheduled payload is ever sent.
  const pending = useRef<PlannerBoard | null>(null);
  // The updated_at we last saw. Sent with each save so the server can reject
  // an overwrite of someone else's newer work rather than silently discarding it.
  const baseUpdatedAt = useRef<string | null>(null);
  const conflicted = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  // Saves must not overlap. Each one stamps a new version, so a second
  // request issued while the first is still in flight would carry a version
  // the server has already moved past and be rejected as someone else's edit.
  const inFlight = useRef(false);
  const queued = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(api)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        return json as BoardResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setBoard(normalizeBoard(json.board ?? defaultBoard()));
        setPersisted(json.persisted);
        baseUpdatedAt.current = json.updated_at;
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Unknown error");
      });
    return () => { cancelled = true; };
  }, [api]);

  const flush = useCallback(async () => {
    if (inFlight.current) { queued.current = true; return; }
    const next = pending.current;
    if (!next) return;
    inFlight.current = true;
    // Deliberately keep `pending` until the write is confirmed: a dropped
    // network or a sleeping laptop must not silently discard the edit.
    setSave({ kind: "saving" });
    try {
      const res = await fetch(api, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: next, baseUpdatedAt: baseUpdatedAt.current }),
      });
      const json = await res.json();

      // 409 means the server refused rather than failed: either someone else
      // saved first, or the write would have wiped the board. Stop autosaving
      // so we cannot keep hammering over their work. Retrying cannot help.
      if (res.status === 409) {
        // Keep `pending` — the edit is unsaved, not unwanted. Autosave stops
        // so we cannot overwrite the other writer, and the banner explains it.
        conflicted.current = true;
        queued.current = false;
        setSave({ kind: "conflict", message: json.error || "This planner changed while you had it open." });
        return;
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      // Only now is the edit durable.
      if (pending.current === next) pending.current = null;
      baseUpdatedAt.current = json.updated_at;
      attempts.current = 0;
      setSave({ kind: "saved", versioned: json.versioned !== false });
    } catch (e) {
      // Transient failure: keep the payload and back off, so a brief outage
      // resolves itself instead of costing the user their edit.
      attempts.current += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** (attempts.current - 1));
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(flush, delay);
      setSave({
        kind: "error",
        message: e instanceof Error ? e.message : "Save failed",
        attempts: attempts.current,
      });
    } finally {
      inFlight.current = false;
      // An edit made while this request was open still needs saving.
      if (queued.current && !conflicted.current) {
        queued.current = false;
        void flush();
      }
    }
  }, [api]);

  const handleChange = useCallback(
    (next: PlannerBoard) => {
      if (readOnly || conflicted.current) return;
      setBoard(next);
      pending.current = next;
      setSave({ kind: "saving" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush, readOnly]
  );

  /** Find the iteration a goal selection points at. */
  function findIteration(sel: Extract<Selection, { kind: "goal" }>) {
    const quarter = board?.quarters.find((q) => q.key === sel.quarterKey);
    return { quarter, iteration: quarter?.iterations.find((it) => it.key === sel.iterationKey) };
  }

  let selectedItem: PlannerItem | null = null;
  if (board && selected) {
    if (selected.kind === "cell") {
      selectedItem = board.cells[selected.cell]?.find((i) => i.id === selected.itemId) ?? null;
    } else {
      selectedItem = findIteration(selected).iteration?.goals.find((g) => g.id === selected.itemId) ?? null;
    }
  }

  /** Human trail at the top of the drawer, e.g. "Branding · Q3 2026 I3 W1". */
  function describe(sel: Selection) {
    if (!board) return "";
    if (sel.kind === "goal") {
      const { quarter, iteration } = findIteration(sel);
      return ["Goal", [quarter?.label, iteration?.label].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    }
    const [rowKey, colKey] = sel.cell.split("|");
    const row = board.rows.find((r) => r.key === rowKey);
    const col = flattenColumns(board).find((c) => c.key === colKey);
    const where = col ? `${col.quarter.label} ${col.iteration.label} ${col.week.label}` : "";
    return [row?.label || "Untitled row", where].filter(Boolean).join(" · ");
  }

  /** Replace the goal list of one iteration. */
  function withGoals(sel: Extract<Selection, { kind: "goal" }>, goals: PlannerItem[]) {
    if (!board) return board!;
    return {
      ...board,
      quarters: board.quarters.map((q) =>
        q.key !== sel.quarterKey
          ? q
          : {
              ...q,
              iterations: q.iterations.map((it) => (it.key === sel.iterationKey ? { ...it, goals } : it)),
            }
      ),
    };
  }

  /** Merge a patch into whichever card is selected, against current state. */
  function updateItem(patch: Partial<PlannerItem>) {
    if (!board || !selected) return;
    const apply = (i: PlannerItem) => (i.id === selected.itemId ? { ...i, ...patch } : i);

    if (selected.kind === "goal") {
      const { iteration } = findIteration(selected);
      if (!iteration) return;
      handleChange(withGoals(selected, iteration.goals.map(apply)));
      return;
    }
    const list = board.cells[selected.cell] ?? [];
    handleChange({ ...board, cells: { ...board.cells, [selected.cell]: list.map(apply) } });
  }

  function deleteItem() {
    if (!board || !selected) return;
    if (selected.kind === "goal") {
      const { iteration } = findIteration(selected);
      if (!iteration) return;
      handleChange(withGoals(selected, iteration.goals.filter((g) => g.id !== selected.itemId)));
      setSelected(null);
      return;
    }
    const list = (board.cells[selected.cell] ?? []).filter((i) => i.id !== selected.itemId);
    const cells = { ...board.cells };
    // Keep the document sparse — an emptied cell is removed, not stored as [].
    if (list.length) cells[selected.cell] = list;
    else delete cells[selected.cell];
    handleChange({ ...board, cells });
    setSelected(null);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (retry.current) clearTimeout(retry.current);
  }, []);

  // The debounce means a very recent edit may not have reached the server yet.
  // Closing the tab in that window would lose it, so ask first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Planner</h1>
          <p className="text-xs text-gray-500 mt-1">
            {/* One expression, not a literal + {" "} + conditional: adjacent
                text nodes are merged by the server renderer but kept separate
                on the client, which trips hydration. */}
            {`${boardParam ? `Sandbox board "${boardParam}" — not the live plan. ` : ""}I3 Q3 2026 → I4 Q2 2027. ${
              readOnly
                ? "Read-only — the planner is authored by owners."
                : "Click any label or cell to edit; changes save automatically."
            }`}
          </p>
        </div>
        <div className="text-xs text-gray-400 min-h-[18px]">
          {save.kind === "error" ? (
            <span className="text-red-500">{statusText(readOnly, save.kind)}</span>
          ) : (
            statusText(readOnly, save.kind)
          )}
        </div>
      </div>

      {!persisted && !readOnly && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          Edits are not being stored yet — run{" "}
          <code className="font-mono">supabase/migrations/20260824_planner_board.sql</code> in the Supabase SQL
          editor to create the <code className="font-mono">planner_boards</code> table.
        </div>
      )}

      {save.kind === "error" && (
        <div className="rounded-xl border border-red-300 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 px-4 py-3 text-sm text-red-800 dark:text-red-300 flex items-center justify-between gap-4 flex-wrap">
          <span>
            Your last change has <strong>not</strong> been saved ({save.message}). Retrying automatically
            {save.attempts > 1 ? ` — attempt ${save.attempts}` : ""}. Keep this tab open.
          </span>
          <button
            type="button"
            onClick={() => flush()}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            Retry now
          </button>
        </div>
      )}

      {save.kind === "saved" && !save.versioned && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          Saved, but version history is unavailable — this change cannot be rolled back. Check that
          <code className="font-mono mx-1">planner_board_versions</code> exists.
        </div>
      )}

      {save.kind === "conflict" && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 flex items-center justify-between gap-4 flex-wrap">
          <span>{save.message} Your recent edits on this screen have not been saved.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
          >
            Reload planner
          </button>
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10 p-6 text-sm text-red-600 dark:text-red-400">
          Could not load the planner: {loadError}
        </div>
      )}

      {!board && !loadError && (
        <div className="rounded-2xl border border-gray-200/70 dark:border-gray-800/70 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-400">
          Loading planner…
        </div>
      )}

      {board && (
        <PlannerGrid
          board={board}
          onChange={handleChange}
          onSelect={(cell, itemId) => setSelected({ kind: "cell", cell, itemId })}
          onSelectGoal={(quarterKey, iterationKey, itemId) =>
            setSelected({ kind: "goal", quarterKey, iterationKey, itemId })
          }
          readOnly={readOnly}
        />
      )}

      {selectedItem && selected && (
        <PlannerItemPanel
          item={selectedItem}
          context={describe(selected)}
          readOnly={readOnly}
          ownerOptions={
            selected.kind === "cell" ? OWNER_CHOICES[selected.cell.split("|")[0]] : undefined
          }
          boardParam={boardParam}
          onChange={updateItem}
          onDelete={deleteItem}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
