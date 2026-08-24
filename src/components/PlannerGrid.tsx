"use client";

import { useMemo, useState } from "react";
import {
  cellKey,
  flattenColumns,
  newItem,
  type PlannerBoard,
  type PlannerItem,
  type PlannerRow,
} from "@/lib/planner-model";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/types";

const RAIL_W = 264;
const COL_W = 132;

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
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${item.title || "Untitled"} — ${STATUS_LABELS[item.status]}${item.owner ? ` · ${item.owner}` : ""}`}
      className="w-full text-left rounded-md px-1.5 py-1 text-[11px] leading-snug hover:ring-2 hover:ring-indigo-400/50 transition-shadow"
      style={{ background: `${color}1F`, borderLeft: `3px solid ${color}` }}
    >
      <span className="line-clamp-2 text-gray-700 dark:text-gray-200 break-words">
        {item.title || <span className="text-gray-400">Untitled</span>}
      </span>
    </button>
  );
}

// ── Row scaffold ─────────────────────────────────────────────────────
function Row({
  rail,
  cols,
  children,
  minHeight,
  rowClass = "",
  railClass = "",
}: {
  rail: React.ReactNode;
  cols: number;
  children?: React.ReactNode;
  minHeight: number;
  rowClass?: string;
  railClass?: string;
}) {
  return (
    <div className={`flex items-stretch ${rowClass}`} style={{ minHeight }}>
      <div
        className={`sticky left-0 z-20 shrink-0 flex items-center px-3 border-r border-b border-gray-200/70 dark:border-gray-800/70 ${railClass}`}
        style={{ width: RAIL_W }}
      >
        {rail}
      </div>
      <div
        className="relative grid border-b border-gray-200/70 dark:border-gray-800/70"
        style={{ gridTemplateColumns: `repeat(${cols}, ${COL_W}px)` }}
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
}: {
  board: PlannerBoard;
  onChange: (next: PlannerBoard) => void;
  /** Opens the detail drawer for a week-cell card. */
  onSelect: (cell: string, itemId: string) => void;
  /** Opens the detail drawer for an iteration goal. */
  onSelectGoal: (quarterKey: string, iterationKey: string, itemId: string) => void;
  readOnly?: boolean;
}) {
  const columns = useMemo(() => flattenColumns(board), [board]);
  const cols = columns.length;

  /** Inclusive column span of each quarter, keyed by quarter key. */
  const quarterSpans = useMemo(() => {
    const spans = new Map<string, [number, number]>();
    columns.forEach((c, i) => {
      const span = spans.get(c.quarter.key);
      if (span) span[1] = i;
      else spans.set(c.quarter.key, [i, i]);
    });
    return spans;
  }, [columns]);

  /** Inclusive column span of each iteration, keyed `${quarterKey}:${iterKey}`. */
  const iterationSpans = useMemo(() => {
    const spans = new Map<string, [number, number]>();
    columns.forEach((c, i) => {
      const key = `${c.quarter.key}:${c.iteration.key}`;
      const span = spans.get(key);
      if (span) span[1] = i;
      else spans.set(key, [i, i]);
    });
    return spans;
  }, [columns]);

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

  if (cols === 0) {
    return (
      <div className="rounded-2xl border border-gray-200/70 dark:border-gray-800/70 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-500">
        This board has no week columns.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200/70 dark:border-gray-800/70 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-180px)]">
        <div style={{ minWidth: RAIL_W + cols * COL_W }}>
          {/* ── Header stack ─────────────────────────────────────── */}
          <div className="sticky top-0 z-30 bg-white dark:bg-gray-900">
            <Row
              cols={cols}
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
                );
              })}
            </Row>

            <Row
              cols={cols}
              minHeight={38}
              railClass="bg-white dark:bg-gray-900"
              rail={<span className="text-sm font-semibold text-gray-900 dark:text-white px-1">Iteration</span>}
            >
              {board.quarters.flatMap((q) =>
                q.iterations.map((it) => {
                  const span = iterationSpans.get(`${q.key}:${it.key}`);
                  if (!span) return null;
                  return (
                    <div
                      key={`${q.key}:${it.key}`}
                      className="m-1 rounded-md flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-semibold"
                      style={{ gridColumn: `${span[0] + 1} / ${span[1] + 2}` }}
                    >
                      <EditableText
                        readOnly={readOnly}
                        value={it.label}
                        align="center"
                        placeholder="Iteration"
                        onCommit={(v) => setIterationLabel(q.key, it.key, v)}
                      />
                    </div>
                  );
                })
              )}
            </Row>

            {/* Goals belong to an iteration, and each iteration can hold
                several — same card shape as the week cells, so they open in
                the same detail drawer. */}
            <Row
              cols={cols}
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
                      className="group/goal m-1 rounded-md flex flex-col gap-1 p-1 bg-indigo-50/70 dark:bg-indigo-500/10"
                      style={{ gridColumn: `${span[0] + 1} / ${span[1] + 2}` }}
                    >
                      {it.goals.map((goal) => (
                        <ItemCard
                          key={goal.id}
                          item={goal}
                          onOpen={() => onSelectGoal(q.key, it.key, goal.id)}
                        />
                      ))}

                      {readOnly
                        ? it.goals.length === 0 && (
                            <span className="text-[11px] text-indigo-300 dark:text-indigo-400/50 px-1.5 text-center">
                              No goals
                            </span>
                          )
                        : (
                          <button
                            type="button"
                            onClick={() => onSelectGoal(q.key, it.key, addGoal(q.key, it.key))}
                            className={`text-[11px] px-1.5 py-1 rounded-md text-indigo-400 hover:text-indigo-700 hover:bg-white/60 dark:hover:bg-white/10 transition-colors ${
                              it.goals.length ? "opacity-0 group-hover/goal:opacity-100" : ""
                            }`}
                          >
                            {it.goals.length ? "+ Add goal" : "+ Add a goal"}
                          </button>
                        )}
                    </div>
                  );
                })
              )}
            </Row>

            <Row
              cols={cols}
              minHeight={34}
              rowClass="bg-gray-50 dark:bg-gray-900"
              railClass="bg-gray-50 dark:bg-gray-900"
              rail={<span className="text-[11px] uppercase tracking-wide text-gray-400 px-1">Week</span>}
            >
              {columns.map((c, i) => (
                <div
                  key={c.key}
                  className="flex items-center justify-center border-r border-gray-100 dark:border-gray-800/60 text-xs font-semibold text-gray-500 dark:text-gray-400"
                  style={{ gridColumn: `${i + 1} / ${i + 2}` }}
                >
                  <EditableText
                    readOnly={readOnly}
                    value={c.week.label}
                    align="center"
                    placeholder="W"
                    onCommit={(v) => setWeekLabel(c.quarter.key, c.iteration.key, c.week.key, v)}
                  />
                </div>
              ))}
            </Row>
          </div>

          {/* ── Body ─────────────────────────────────────────────── */}
          {board.rows.map((row, index) =>
            row.kind === "section" ? (
              <Row
                key={row.key}
                cols={cols}
                minHeight={38}
                rowClass="bg-gray-50 dark:bg-gray-800"
                railClass="bg-gray-50 dark:bg-gray-800 group"
                rail={
                  <div className="flex items-center gap-1 w-full">
                    <EditableText
                      readOnly={readOnly}
                      value={row.label}
                      placeholder="Section"
                      className="text-[13px] font-semibold text-gray-900 dark:text-white"
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
                {columns.map((c, i) => (
                  <div
                    key={c.key}
                    aria-hidden
                    className="border-r border-gray-100 dark:border-gray-800/50"
                    style={{ gridColumn: `${i + 1} / ${i + 2}` }}
                  />
                ))}
              </Row>
            ) : (
              <Row
                key={row.key}
                cols={cols}
                minHeight={44}
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
                {columns.map((c, i) => {
                  const key = cellKey(row.key, c.key);
                  const items = board.cells[key] ?? [];
                  return (
                    <div
                      key={c.key}
                      className="group/cell flex flex-col gap-1 border-r border-gray-100 dark:border-gray-800/50 p-1"
                      style={{ gridColumn: `${i + 1} / ${i + 2}` }}
                    >
                      {items.map((item) => (
                        <ItemCard key={item.id} item={item} onOpen={() => onSelect(key, item.id)} />
                      ))}

                      {readOnly
                        ? items.length === 0 && <span className="text-[11px] text-gray-300 dark:text-gray-600 px-1.5">–</span>
                        : (
                          <button
                            type="button"
                            onClick={() => onSelect(key, addItem(row.key, c.key))}
                            title="Add an item"
                            className={`text-left text-[11px] px-1.5 py-1 rounded-md text-gray-300 dark:text-gray-600 hover:text-indigo-600 hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10 transition-colors ${
                              items.length ? "opacity-0 group-hover/cell:opacity-100" : ""
                            }`}
                          >
                            {items.length ? "+ Add" : "–"}
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
