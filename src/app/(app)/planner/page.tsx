"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  | { kind: "idle" | "saving" | "saved" }
  | { kind: "error"; message: string }
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
  return "";
}

export default function PlannerPage() {
  // Reps (@mimimomentum.com) review the plan; owners author it. Mirrors the
  // task-editing rule, and /api/planner enforces the same check server-side.
  const { appRole } = useAuth();
  const readOnly = !canEditTasks(appRole);

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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/planner")
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
  }, []);

  const flush = useCallback(async () => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setSave({ kind: "saving" });
    try {
      const res = await fetch("/api/planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: next, baseUpdatedAt: baseUpdatedAt.current }),
      });
      const json = await res.json();

      // 409 means the server refused rather than failed: either someone else
      // saved first, or the write would have wiped the board. Stop autosaving
      // so we cannot keep hammering over their work.
      if (res.status === 409) {
        conflicted.current = true;
        pending.current = null;
        setSave({ kind: "conflict", message: json.error || "This planner changed while you had it open." });
        return;
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      baseUpdatedAt.current = json.updated_at;
      setSave({ kind: "saved" });
    } catch (e) {
      setSave({ kind: "error", message: e instanceof Error ? e.message : "Save failed" });
    }
  }, []);

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

  // Don't leave a debounced edit unsent when the user navigates away.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Planner</h1>
          <p className="text-xs text-gray-500 mt-1">
            {/* One expression, not a literal + {" "} + conditional: adjacent
                text nodes are merged by the server renderer but kept separate
                on the client, which trips hydration. */}
            {`I3 Q3 2026 → I4 Q2 2027. ${
              readOnly
                ? "Read-only — the planner is authored by owners."
                : "Click any label or cell to edit; changes save automatically."
            }`}
          </p>
        </div>
        <div className="text-xs text-gray-400 min-h-[18px]">
          {save.kind === "error" ? (
            <span className="text-red-500">{save.message}</span>
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
          onChange={updateItem}
          onDelete={deleteItem}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
