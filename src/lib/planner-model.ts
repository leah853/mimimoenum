// Planner board model.
//
// The planner is a standalone editable canvas, not a projection of the tasks
// table: every label, band and cell is typed in by the user. The whole board
// is one document so a single save round-trips the entire grid.

import type { TaskStatus } from "@/lib/types";

/**
 * One card inside a week cell. Status reuses the app-wide TaskStatus so the
 * planner's colours and labels match Tasks, Milestones and the rest of the UI.
 */
export interface PlannerItem {
  id: string;
  title: string;
  status: TaskStatus;
  owner?: string;
  note?: string;
}

export interface PlannerWeek {
  key: string;
  label: string;
}

export interface PlannerIteration {
  key: string;
  label: string;
  weeks: PlannerWeek[];
}

export interface PlannerQuarter {
  key: string;
  label: string;
  /** The Goals band that spans this quarter. */
  goal: string;
  iterations: PlannerIteration[];
}

export interface PlannerRow {
  key: string;
  label: string;
  /** "section" is a group heading with no cells; "row" holds editable cells. */
  kind: "section" | "row";
  /** Render the label in the heavier weight used for section headings. */
  strong?: boolean;
}

export interface PlannerBoard {
  quarters: PlannerQuarter[];
  rows: PlannerRow[];
  /** Sparse map, keyed `${rowKey}|${colKey}`. Empty cells are simply absent. */
  cells: Record<string, PlannerItem[]>;
}

/** Stable column identifier for a single week. */
export function colKey(q: PlannerQuarter, it: PlannerIteration, w: PlannerWeek) {
  return `${q.key}:${it.key}:${w.key}`;
}

export function cellKey(rowKey: string, col: string) {
  return `${rowKey}|${col}`;
}

/** Flatten the quarter → iteration → week tree into ordered week columns. */
export function flattenColumns(board: PlannerBoard) {
  const columns: { key: string; quarter: PlannerQuarter; iteration: PlannerIteration; week: PlannerWeek }[] = [];
  for (const q of board.quarters) {
    for (const it of q.iterations) {
      for (const w of it.weeks) {
        columns.push({ key: colKey(q, it, w), quarter: q, iteration: it, week: w });
      }
    }
  }
  return columns;
}

export function newItem(title = ""): PlannerItem {
  return { id: crypto.randomUUID(), title, status: "not_started" };
}

/**
 * Coerce a stored board into the current shape.
 *
 * Cells were originally a single string per cell; they now hold a list of
 * cards. Boards saved under the old shape are still valid JSON in the
 * database, so upgrade them on read rather than requiring a data migration.
 */
export function normalizeBoard(board: PlannerBoard): PlannerBoard {
  const cells: Record<string, PlannerItem[]> = {};
  // Stored cells come from JSONB, so the runtime shape is wider than the type.
  const stored = (board.cells ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(stored)) {
    if (Array.isArray(value)) {
      const items = (value as PlannerItem[]).filter((i) => i && typeof i.title === "string");
      if (items.length) cells[key] = items;
    } else if (typeof value === "string" && value.trim()) {
      // Legacy single-string cell → one card carrying the same text.
      cells[key] = [{ id: `legacy-${key}`, title: value, status: "not_started" }];
    }
  }
  return { ...board, cells };
}

function weeks(count = 3): PlannerWeek[] {
  return Array.from({ length: count }, (_, i) => ({ key: `w${i + 1}`, label: `W${i + 1}` }));
}

function iterations(numbers: number[]): PlannerIteration[] {
  return numbers.map((n) => ({ key: `i${n}`, label: `I${n}`, weeks: weeks() }));
}

/**
 * Default board: the timeline runs from I3 of Q3 2026 through I4 of Q2 2027,
 * and the left rail carries exactly the sections and rows from the source
 * design — nothing derived, nothing inferred.
 */
export function defaultBoard(): PlannerBoard {
  return {
    quarters: [
      { key: "q3-2026", label: "Q3 2026", goal: "Complete Prep & Execute", iterations: iterations([3, 4]) },
      { key: "q4-2026", label: "Q4 2026", goal: "", iterations: iterations([1, 2, 3, 4]) },
      { key: "q1-2027", label: "Q1 2027", goal: "", iterations: iterations([1, 2, 3, 4]) },
      { key: "q2-2027", label: "Q2 2027", goal: "", iterations: iterations([1, 2, 3, 4]) },
    ],
    rows: [
      { key: "prerequisites", label: "Prerequisites", kind: "row", strong: true },
      { key: "milestone", label: "Milestone", kind: "section" },
      { key: "branding", label: "Branding", kind: "row" },
      { key: "campaign", label: "Campaign", kind: "row" },
      { key: "product-engg", label: "Product & Engg", kind: "section" },
      { key: "workflows", label: "Workflows", kind: "row" },
      { key: "engg-mvp", label: "Engg - MVP", kind: "row" },
      { key: "cybersecurity", label: "Cybersecurity", kind: "row" },
      { key: "people", label: "People", kind: "section" },
      { key: "talent-acquisition", label: "Talent acquisition", kind: "row" },
      { key: "hackathon-community", label: "Hackathon & community", kind: "row" },
      { key: "knowledge-culture", label: "Knowledge & culture", kind: "row" },
      { key: "consultant-hiring", label: "Consultant hiring", kind: "row" },
    ],
    cells: {},
  };
}
