"use client";

import { useMemo, useState } from "react";
import {
  cellKey,
  flattenColumns,
  formatRange,
  iterationRange,
  newItem,
  summarize,
  weekItems,
  isCellSynced,
  PLANNER_ROW_TO_CATEGORY,
  type ProgressStats,
  type PlannerBoard,
  type PlannerItem,
  type PlannerRow,
} from "@/lib/planner-model";
import { STATUS_COLORS, STATUS_LABELS, type TaskStatus } from "@/lib/types";

const STATUS_ORDER: TaskStatus[] = ["completed", "under_review", "in_progress", "not_started", "blocked"];

/** Stacked status bar — one segment per status, sized by share of the total. */
function StatusBar({ stats, height = 4 }: { stats: ProgressStats; height?: number }) {
  if (!stats.total) {
    return <div className="w-full rounded-full bg-gray-200/70 dark:bg-gray-700/50" style={{ height }} />;
  }
  return (
    <div className="w-full flex rounded-full overflow-hidden" style={{ height }}>
      {STATUS_ORDER.map((status) => {
        const count = stats.byStatus[status];
        if (!count) return null;
        return (
          <div
            key={status}
            style={{ width: `${(count / stats.total) * 100}%`, background: STATUS_COLORS[status] }}
          />
        );
      })}
    </div>
  );
}

/** Screen-reader-and-tooltip friendly summary of a ProgressStats. */
function statsTitle(label: string, stats: ProgressStats) {
  if (!stats.total) return `${label}: nothing planned yet`;
  const parts = STATUS_ORDER.filter((s) => stats.byStatus[s]).map(
    (s) => `${stats.byStatus[s]} ${STATUS_LABELS[s].toLowerCase()}`
  );
  return `${label}: ${stats.percent}% complete · ${stats.total} item${stats.total === 1 ? "" : "s"} — ${parts.join(", ")}`;
}

const RAIL_W = 224;
const COL_W = 164;
/**
 * The Breather column is a spacer, not a first-class column — narrower than
 * a week so the eye reads it as a gap between quarters rather than another
 * week to plan into.
 */
const BREATHER_W = Math.round(COL_W * 0.6);

/** Format a "start – end" date range like "27 Sep – 3 Oct". */
function breatherRange(start: string, end: string) {
  return formatRange(start, end);
}

// ── Inline editor ────────────────────────────────────────────────────
// One component for every editable surface: rail labels, band labels, week
// labels and grid cells. Renders as plain text until clicked, so the board
// reads as a document rather than a wall of form controls.
function EditableText({
  value,
  onCommit,
  placeholder = "",
  className = "",
  inputClassName = "",
  multiline = false,
  align = "left",
  readOnly = false,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  align?: "left" | "center";
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function begin() {
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  }

  if (editing) {
    const shared = {
      autoFocus: true,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
        // Enter commits; Shift+Enter keeps a newline in multiline cells.
        if (e.key === "Enter" && (!multiline || !e.shiftKey)) { e.preventDefault(); commit(); }
      },
      className:
        `w-full bg-white dark:bg-gray-950 border border-indigo-400 rounded px-1.5 py-1 outline-none ` +
        `text-inherit font-inherit resize-none ${align === "center" ? "text-center" : ""} ${inputClassName}`,
    };
    return multiline ? <textarea rows={2} {...shared} /> : <input type="text" {...shared} />;
  }

  if (readOnly) {
    return (
      <div
        className={`w-full px-1.5 py-1 whitespace-pre-wrap break-words ${
          align === "center" ? "text-center" : ""
        } ${className}`}
      >
        {value || <span className="text-gray-300 dark:text-gray-600">{placeholder}</span>}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={begin}
      // Enter/Space opens the editor, but focus alone must not: committing an
      // edit returns focus here, and reopening on focus would trap the cell.
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); begin(); }
      }}
      title="Click to edit"
      className={`w-full cursor-text rounded px-1.5 py-1 whitespace-pre-wrap break-words hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${
        align === "center" ? "text-center" : ""
      } ${className}`}
    >
      {value || <span className="text-gray-300 dark:text-gray-600">{placeholder}</span>}
    </div>
  );
}

/** One card in a week cell: status colour on the left edge, click to open. */
function ItemCard({ item, onOpen }: { item: PlannerItem; onOpen: () => void }) {
  const color = STATUS_COLORS[item.status] ?? STATUS_COLORS.not_started;
  // Overdue matches the Tasks Board treatment: warm-red tint + border. Same
  // hex values, so a card the user recognises from Tasks stays recognisable
  // here.
  const overdue = !!item.overdue;
  const isTask = item.source === "task";
  const style: React.CSSProperties = overdue
    ? { background: "#FFF5F5", borderLeft: `2px solid ${color}`, boxShadow: "inset 0 0 0 1px #FCA5A5" }
    : { background: `${color}12`, borderLeft: `2px solid ${color}` };
  const titleText = `${item.title || "Untitled"} — ${STATUS_LABELS[item.status]}${
    item.owner ? ` · ${item.owner}` : ""
  }${overdue ? " · overdue" : ""}${isTask ? " · synced with Tasks" : ""}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={titleText}
      className="group/card w-full text-left rounded-[3px] flex items-center gap-1 pl-2 pr-1.5 py-[3px] text-[11px] leading-[1.4] hover:ring-1 hover:ring-indigo-400/70 transition-all"
      style={style}
    >
      <span className="truncate block flex-1 text-gray-700 dark:text-gray-200">
        {item.title || <span className="text-gray-400">Untitled</span>}
      </span>
      {isTask && (
        <span
          aria-label="Shared with Tasks"
          title="Shared with Tasks"
          className="shrink-0 text-[8.5px] font-semibold tracking-wider uppercase rounded-sm px-1 py-[1px] text-indigo-700 dark:text-indigo-200 bg-indigo-100/80 dark:bg-indigo-500/20"
        >
          T
        </span>
      )}
    </button>
  );
}

// ── Row scaffold ─────────────────────────────────────────────────────
function Row({
  rail,
  template,
  children,
  minHeight,
  rowClass = "",
  railClass = "",
  scrolled = false,
}: {
  rail: React.ReactNode;
  /** Explicit `grid-template-columns` — columns vary in width once breathers
   *  are interleaved, so a simple repeat() no longer suffices. */
  template: string;
  children?: React.ReactNode;
  minHeight: number;
  rowClass?: string;
  railClass?: string;
  /** Casts a shadow off the rail once columns slide beneath it. */
  scrolled?: boolean;
}) {
  return (
    <div className={`flex items-stretch ${rowClass}`} style={{ minHeight }}>
      <div
        className={`sticky left-0 z-20 shrink-0 flex items-center px-3 border-r border-b border-gray-200/70 dark:border-gray-800/70 transition-shadow ${railClass}`}
        style={{ width: RAIL_W, boxShadow: scrolled ? "6px 0 12px -6px rgba(15,23,42,0.18)" : undefined }}
      >
        {rail}
      </div>
      <div
        className="relative grid border-b border-gray-200/70 dark:border-gray-800/70"
        style={{ gridTemplateColumns: template }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Grid ─────────────────────────────────────────────────────────────
export default function PlannerGrid({
  board,
  onChange,
  onSelect,
  onSelectGoal,
  readOnly = false,
  syncContext = null,
  onSyncedAdd,
}: {
  board: PlannerBoard;
  onChange: (next: PlannerBoard) => void;
  /** Opens the detail drawer for a week-cell card. */
  onSelect: (cell: string, itemId: string) => void;
  /** Opens the detail drawer for an iteration goal. */
  onSelectGoal: (quarterKey: string, iterationKey: string, itemId: string) => void;
  readOnly?: boolean;
  /**
   * Map of week column-key → sync IDs. Cells whose column-key is in this map
   * AND whose row_key is in PLANNER_ROW_TO_CATEGORY are backed by /api/tasks;
   * mutations go through `onSyncedAdd` (add) and the parent's task-aware
   * `updateItem`/`deleteItem` (edit/delete via the detail drawer).
   */
  syncContext?: Record<string, unknown> | null;
  /** Create a new task for a synced cell. Returns the new item id or null. */
  onSyncedAdd?: (rowKey: string, colKey: string) => Promise<string | null>;
}) {
  /**
   * The rendered column sequence: every week from the board, interleaved with
   * a narrower "breather" spacer after each quarter that has one. Breather
   * columns carry no cells and no interactions — they are visual reflection
   * markers between quarters.
   */
  type WeekDef = ReturnType<typeof flattenColumns>[number];
  type ColumnDef =
    | { kind: "week"; key: string; def: WeekDef; width: number }
    | {
        kind: "breather";
        key: string;
        quarterKey: string;
        quarterLabel: string;
        breather: { start: string; end: string };
        width: number;
      };
  const columnDefs = useMemo<ColumnDef[]>(() => {
    const defs: ColumnDef[] = [];
    for (const q of board.quarters) {
      for (const it of q.iterations) {
        for (const w of it.weeks) {
          const key = `${q.key}:${it.key}:${w.key}`;
          defs.push({
            kind: "week",
            key,
            def: { key, quarter: q, iteration: it, week: w },
            width: COL_W,
          });
        }
      }
      if (q.breather) {
        defs.push({
          kind: "breather",
          key: `${q.key}:breather`,
          quarterKey: q.key,
          quarterLabel: q.label,
          breather: q.breather,
          width: BREATHER_W,
        });
      }
    }
    return defs;
  }, [board.quarters]);
  const totalCols = columnDefs.length;
  const gridTemplate = useMemo(
    () => columnDefs.map((d) => `${d.width}px`).join(" "),
    [columnDefs]
  );
  const boardWidth = useMemo(
    () => columnDefs.reduce((sum, d) => sum + d.width, 0),
    [columnDefs]
  );

  const [scrolled, setScrolled] = useState(false);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  /** columnDefs index of the week containing today, or -1 when out of range. */
  const todayCol = useMemo(
    () =>
      columnDefs.findIndex(
        (c) => c.kind === "week" && c.def.week.start <= today && today <= c.def.week.end
      ),
    [columnDefs, today]
  );

  /**
   * Inclusive column span of each quarter, keyed by quarter key. Includes the
   * breather column when present so the quarter's header block visually wraps
   * its reflection week too.
   */
  const quarterSpans = useMemo(() => {
    const spans = new Map<string, [number, number]>();
    columnDefs.forEach((c, i) => {
      const qKey = c.kind === "week" ? c.def.quarter.key : c.quarterKey;
      const span = spans.get(qKey);
      if (span) span[1] = i;
      else spans.set(qKey, [i, i]);
    });
    return spans;
  }, [columnDefs]);

  /**
   * Inclusive column span of each iteration, keyed `${quarterKey}:${iterKey}`.
   * Iterations own only their week columns — the breather sits outside every
   * iteration, so the Iteration and Goals rows leave that column empty.
   */
  const iterationSpans = useMemo(() => {
    const spans = new Map<string, [number, number]>();
    columnDefs.forEach((c, i) => {
      if (c.kind !== "week") return;
      const key = `${c.def.quarter.key}:${c.def.iteration.key}`;
      const span = spans.get(key);
      if (span) span[1] = i;
      else spans.set(key, [i, i]);
    });
    return spans;
  }, [columnDefs]);

  // ── Mutations (all immutable, all routed through onChange) ─────────
  /** Append a blank card to a cell and return its id so it can be opened. */
  function addItem(rowKey: string, col: string) {
    const key = cellKey(rowKey, col);
    const item = newItem();
    onChange({ ...board, cells: { ...board.cells, [key]: [...(board.cells[key] ?? []), item] } });
    return item.id;
  }

  function setRowLabel(rowKey: string, label: string) {
    onChange({ ...board, rows: board.rows.map((r) => (r.key === rowKey ? { ...r, label } : r)) });
  }

  function setQuarterLabel(qKey: string, label: string) {
    onChange({ ...board, quarters: board.quarters.map((q) => (q.key === qKey ? { ...q, label } : q)) });
  }

  /** Append a blank goal to an iteration and return its id so it can be opened. */
  function addGoal(qKey: string, itKey: string) {
    const goal = newItem();
    onChange({
      ...board,
      quarters: board.quarters.map((q) =>
        q.key !== qKey
          ? q
          : {
              ...q,
              iterations: q.iterations.map((it) =>
                it.key === itKey ? { ...it, goals: [...it.goals, goal] } : it
              ),
            }
      ),
    });
    return goal.id;
  }

  function setIterationLabel(qKey: string, itKey: string, label: string) {
    onChange({
      ...board,
      quarters: board.quarters.map((q) =>
        q.key !== qKey ? q : { ...q, iterations: q.iterations.map((it) => (it.key === itKey ? { ...it, label } : it)) }
      ),
    });
  }

  function setWeekLabel(qKey: string, itKey: string, wKey: string, label: string) {
    onChange({
      ...board,
      quarters: board.quarters.map((q) =>
        q.key !== qKey
          ? q
          : {
              ...q,
              iterations: q.iterations.map((it) =>
                it.key !== itKey ? it : { ...it, weeks: it.weeks.map((w) => (w.key === wKey ? { ...w, label } : w)) }
              ),
            }
      ),
    });
  }

  /** Insert a blank row directly beneath `afterKey`. */
  function addRowAfter(afterKey: string) {
    const at = board.rows.findIndex((r) => r.key === afterKey);
    if (at === -1) return;
    const row: PlannerRow = { key: `row-${crypto.randomUUID().slice(0, 8)}`, label: "", kind: "row" };
    const rows = [...board.rows];
    rows.splice(at + 1, 0, row);
    onChange({ ...board, rows });
  }

  function removeRow(rowKey: string) {
    const cells = { ...board.cells };
    for (const key of Object.keys(cells)) {
      if (key.startsWith(`${rowKey}|`)) delete cells[key];
    }
    onChange({ ...board, rows: board.rows.filter((r) => r.key !== rowKey), cells });
  }

  /** Index of the last row belonging to the section that starts at `index`. */
  function sectionTail(index: number) {
    let i = index + 1;
    while (i < board.rows.length && board.rows[i].kind !== "section") i++;
    return i - 1;
  }

  if (totalCols === 0) {
    return (
      <div className="rounded-2xl border border-gray-200/70 dark:border-gray-800/70 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-500">
        This board has no week columns.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200/70 dark:border-gray-800/70 bg-white dark:bg-gray-900 overflow-hidden">
      <div
        className="overflow-auto max-h-[calc(100vh-180px)]"
        onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 4)}
      >
        <div style={{ minWidth: RAIL_W + boardWidth }}>
          {/* ── Header stack ─────────────────────────────────────── */}
          <div className="sticky top-0 z-30 bg-white dark:bg-gray-900">
            <Row
              scrolled={scrolled}
              template={gridTemplate}
              minHeight={44}
              railClass="bg-white dark:bg-gray-900"
              rail={<span className="text-sm font-semibold text-gray-900 dark:text-white px-1">Timeline</span>}
            >
              {board.quarters.map((q) => {
                const span = quarterSpans.get(q.key);
                if (!span) return null;
                return (
                  <div
                    key={q.key}
                    className="m-1 rounded-lg flex items-center justify-center gradient-primary text-white text-sm font-semibold"
                    style={{ gridColumn: `${span[0] + 1} / ${span[1] + 2}` }}
                  >
                    {/* Pin the label: a quarter spans up to twelve columns, so
                        a centred label scrolls out of sight on a wide board. */}
                    <div className="sticky px-2" style={{ left: RAIL_W + 8 }}>
                    <EditableText
                      readOnly={readOnly}
                      value={q.label}
                      align="center"
                      placeholder="Quarter"
                      className="text-white"
                      inputClassName="text-gray-900 dark:text-white font-semibold"
                      onCommit={(v) => setQuarterLabel(q.key, v)}
                    />
                    </div>
                  </div>
                );
              })}
            </Row>

            <Row
              scrolled={scrolled}
              template={gridTemplate}
              minHeight={38}
              railClass="bg-white dark:bg-gray-900"
              rail={<span className="text-sm font-semibold text-gray-900 dark:text-white px-1">Iteration</span>}
            >
              {board.quarters.flatMap((q) =>
                q.iterations.map((it) => {
                  const span = iterationSpans.get(`${q.key}:${it.key}`);
                  if (!span) return null;
                  const goalStats = summarize(it.goals);
                  return (
                    <div
                      key={`${q.key}:${it.key}`}
                      title={statsTitle(`${it.label} goals`, goalStats)}
                      className="m-1 px-2 py-1 rounded-md flex flex-col justify-center gap-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                      style={{ gridColumn: `${span[0] + 1} / ${span[1] + 2}` }}
                    >
                      <div className="flex items-baseline justify-center gap-1.5 text-xs font-semibold">
                        <EditableText
                          readOnly={readOnly}
                          value={it.label}
                          align="center"
                          placeholder="Iteration"
                          className="!w-auto"
                          onCommit={(v) => setIterationLabel(q.key, it.key, v)}
                        />
                        <span className="text-[10px] font-normal text-gray-400 whitespace-nowrap">
                          {iterationRange(it)}
                        </span>
                      </div>
                      {goalStats.total > 0 && (
                        <div className="flex items-center gap-1.5">
                          <StatusBar stats={goalStats} />
                          <span className="text-[9.5px] tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {goalStats.percent}%
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </Row>

            {/* Goals belong to an iteration, and each iteration can hold
                several — same card shape as the week cells, so they open in
                the same detail drawer. */}
            <Row
              scrolled={scrolled}
              template={gridTemplate}
              minHeight={40}
              railClass="bg-white dark:bg-gray-900"
              rail={<span className="text-sm font-semibold text-gray-900 dark:text-white px-1">Goals</span>}
            >
              {board.quarters.flatMap((q) =>
                q.iterations.map((it) => {
                  const span = iterationSpans.get(`${q.key}:${it.key}`);
                  if (!span) return null;
                  return (
                    <div
                      key={`${q.key}:${it.key}`}
                      className="group/goal relative m-1 rounded-md p-1 pb-1 bg-indigo-50/70 dark:bg-indigo-500/10"
                      style={{ gridColumn: `${span[0] + 1} / ${span[1] + 2}` }}
                    >
                      {/* No cap: goals are read at a glance, so hiding some of
                          them behind a scrollbar defeats the point of the row. */}
                      <div className="flex flex-col gap-[5px]">
                        {it.goals.map((goal) => (
                          <ItemCard
                            key={goal.id}
                            item={goal}
                            onOpen={() => onSelectGoal(q.key, it.key, goal.id)}
                          />
                        ))}
                      </div>

                      {/* Overlaid, not in flow: the Goals row is as tall as
                          its fullest iteration, so a hidden button in all
                          fourteen bands would pad the row needlessly. */}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => onSelectGoal(q.key, it.key, addGoal(q.key, it.key))}
                          className={
                            it.goals.length
                              ? "absolute left-1 right-1 bottom-0 h-4 rounded text-[10px] leading-none text-indigo-500 bg-white/70 dark:bg-white/10 opacity-0 group-hover/goal:opacity-100 focus:opacity-100 transition-opacity"
                              : "absolute inset-0 text-[11px] text-indigo-400 hover:text-indigo-700 transition-colors"
                          }
                        >
                          {it.goals.length ? "+ Add goal" : "+ Add a goal"}
                        </button>
                      )}
                      {readOnly && it.goals.length === 0 && (
                        <span className="text-[11px] text-indigo-300 dark:text-indigo-400/50 px-1.5 text-center">
                          No goals
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </Row>

            <Row
              scrolled={scrolled}
              template={gridTemplate}
              minHeight={54}
              rowClass="bg-gray-50 dark:bg-gray-900"
              railClass="bg-gray-50 dark:bg-gray-900"
              rail={<span className="text-[11px] uppercase tracking-wide text-gray-400 px-1">Week</span>}
            >
              {columnDefs.map((cd, i) => {
                if (cd.kind === "breather") {
                  const range = breatherRange(cd.breather.start, cd.breather.end);
                  return (
                    <div
                      key={cd.key}
                      title={`Reflection & reset week between quarters — no tasks planned here.\n${cd.quarterLabel} · ${range}`}
                      className="flex flex-col items-center justify-center gap-1 px-1 border-r"
                      style={{
                        gridColumn: `${i + 1} / ${i + 2}`,
                        background: "#FBFAF5",
                        borderRightColor: "#E8E5DC",
                      }}
                    >
                      <span
                        className="text-[9px] font-bold uppercase tracking-[0.14em] px-1.5 py-[2px] rounded-full"
                        style={{
                          background: "#FFFFFF",
                          color: "#8A7F60",
                          border: "1px solid #E8E5DC",
                        }}
                      >
                        Breather
                      </span>
                      <div className="text-[9.5px] leading-none text-center whitespace-nowrap" style={{ color: "#8A7F60" }}>
                        {range}
                      </div>
                    </div>
                  );
                }
                const c = cd.def;
                const stats = summarize(weekItems(board, c.key));
                const isCurrent = i === todayCol;
                return (
                  <div
                    key={c.key}
                    title={statsTitle(`${c.iteration.label} ${c.week.label}`, stats)}
                    className={`flex flex-col justify-center gap-0.5 px-1.5 border-r border-gray-100 dark:border-gray-800/60 ${
                      isCurrent ? "bg-indigo-50/70 dark:bg-indigo-500/10" : ""
                    }`}
                    style={{ gridColumn: `${i + 1} / ${i + 2}` }}
                  >
                    <div
                      className={`text-xs font-semibold text-center ${
                        isCurrent ? "text-indigo-600 dark:text-indigo-400" : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      <EditableText
                        readOnly={readOnly}
                        value={c.week.label}
                        align="center"
                        placeholder="W"
                        onCommit={(v) => setWeekLabel(c.quarter.key, c.iteration.key, c.week.key, v)}
                      />
                    </div>
                    <div className="text-[9.5px] text-gray-400 text-center whitespace-nowrap leading-none">
                      {formatRange(c.week.start, c.week.end)}
                    </div>
                    <div className="flex items-center gap-1">
                      <StatusBar stats={stats} height={3} />
                      <span className="text-[9px] tabular-nums text-gray-400 w-6 text-right">
                        {stats.total ? `${stats.percent}%` : "–"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </Row>
          </div>

          {/* ── Body ─────────────────────────────────────────────── */}
          {board.rows.map((row, index) =>
            row.kind === "section" ? (
              <Row
                key={row.key}
                scrolled={scrolled}
                template={gridTemplate}
                minHeight={30}
                rowClass="bg-gray-100/80 dark:bg-gray-800"
                railClass="bg-gray-100/80 dark:bg-gray-800 group"
                rail={
                  <div className="flex items-center gap-1 w-full">
                    <EditableText
                      readOnly={readOnly}
                      value={row.label}
                      placeholder="Section"
                      className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                      onCommit={(v) => setRowLabel(row.key, v)}
                    />
                    {!readOnly && (
                    <button
                      type="button"
                      onClick={() => addRowAfter(board.rows[sectionTail(index)]?.key ?? row.key)}
                      title="Add a row to this section"
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-gray-400 hover:text-indigo-600 text-base leading-none px-1"
                    >
                      +
                    </button>
                    )}
                  </div>
                }
              >
                <div aria-hidden style={{ gridColumn: `1 / ${totalCols + 1}` }} />
              </Row>
            ) : (
              <Row
                key={row.key}
                scrolled={scrolled}
                template={gridTemplate}
                minHeight={34}
                rowClass="hover:bg-indigo-50/30 dark:hover:bg-indigo-500/[0.04] transition-colors"
                railClass="bg-white dark:bg-gray-900 group"
                rail={
                  <div className="flex items-center gap-1 w-full">
                    <EditableText
                      readOnly={readOnly}
                      value={row.label}
                      placeholder="Row name"
                      className={
                        row.strong
                          ? "text-[13px] font-semibold text-gray-900 dark:text-white"
                          : "text-[13px] text-gray-600 dark:text-gray-300"
                      }
                      onCommit={(v) => setRowLabel(row.key, v)}
                    />
                    {!readOnly && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      title="Delete this row"
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-gray-300 hover:text-red-500 text-sm leading-none px-1"
                    >
                      ×
                    </button>
                    )}
                  </div>
                }
              >
                {columnDefs.map((cd, i) => {
                  // Breather column now holds real cells. Keep the tan tint so
                  // it still reads as the reflection week, but let users drop
                  // (i.e. add) tasks into it exactly like any other week.
                  const isBreatherCol = cd.kind === "breather";
                  const key = cellKey(row.key, cd.key);
                  const items = board.cells[key] ?? [];
                  const colStyle: React.CSSProperties = { gridColumn: `${i + 1} / ${i + 2}` };
                  if (isBreatherCol) {
                    colStyle.background = "#FBFAF5";
                    colStyle.borderRightColor = "#E8E5DC";
                  }
                  const isTodayCol = !isBreatherCol && i === todayCol;
                  return (
                    <div
                      key={cd.key}
                      title={isBreatherCol ? "Breather week — reflection & reset. Tasks are allowed here." : undefined}
                      className={`group/cell relative flex flex-col gap-[5px] border-r px-1.5 py-1.5 ${
                        isBreatherCol
                          ? ""
                          : `border-gray-100 dark:border-gray-800/50 ${
                              isTodayCol ? "bg-indigo-50/40 dark:bg-indigo-500/[0.06]" : ""
                            }`
                      }`}
                      style={colStyle}
                    >
                      {items.map((item) => (
                        <ItemCard key={item.id} item={item} onOpen={() => onSelect(key, item.id)} />
                      ))}

                      {/* Absolutely positioned so it never contributes height:
                          otherwise a hidden button in all 42 cells inflates
                          every row, including the empty ones. */}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={async () => {
                            const synced =
                              isCellSynced(cd.key, syncContext) &&
                              !!PLANNER_ROW_TO_CATEGORY[row.key];
                            let id: string | null;
                            if (synced && onSyncedAdd) {
                              id = await onSyncedAdd(row.key, cd.key);
                            } else if (synced) {
                              return; // Task backing not wired — refuse silently rather than desynchronising
                            } else {
                              id = addItem(row.key, cd.key);
                            }
                            if (id) onSelect(key, id);
                          }}
                          title={isBreatherCol ? "Add a breather task" : "Add an item"}
                          className={
                            items.length
                              ? "absolute left-1 right-1 bottom-0 h-4 rounded text-[10px] leading-none text-indigo-500 bg-indigo-50/90 dark:bg-indigo-500/20 opacity-0 group-hover/cell:opacity-100 focus:opacity-100 transition-opacity"
                              : "absolute inset-0 text-[10px] text-indigo-500 opacity-0 group-hover/cell:opacity-100 focus:opacity-100 transition-opacity"
                          }
                        >
                          + Add
                        </button>
                      )}
                    </div>
                  );
                })}
              </Row>
            )
          )}

          {/* Append a row at the very bottom of the board. */}
          {!readOnly && (
          <div className="flex">
            <div className="sticky left-0 z-20 shrink-0 px-3 py-2" style={{ width: RAIL_W }}>
              <button
                type="button"
                onClick={() => addRowAfter(board.rows[board.rows.length - 1]?.key ?? "")}
                className="text-[12px] text-gray-400 hover:text-indigo-600 transition-colors"
              >
                + Add row
              </button>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
