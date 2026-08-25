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
  /** ISO date (YYYY-MM-DD) of the Monday this week starts. */
  start: string;
  /** ISO date of the Sunday it ends. */
  end: string;
}

export interface PlannerIteration {
  key: string;
  label: string;
  weeks: PlannerWeek[];
  /** Goals for this iteration. Same card shape as week-cell items. */
  goals: PlannerItem[];
}

export interface PlannerQuarter {
  key: string;
  label: string;
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
  // Boards saved before weeks carried dates get them backfilled in board order.
  let weekCursor = 0;

  const quarters = (board.quarters ?? []).map((q) => {
    // Goals used to be a single string on the quarter. Move one onto the
    // quarter's first iteration rather than dropping the text.
    const legacy = (q as unknown as { goal?: string }).goal;
    const carried: PlannerItem[] =
      typeof legacy === "string" && legacy.trim()
        ? [{ id: `legacy-goal-${q.key}`, title: legacy, status: "not_started" }]
        : [];

    const iterations = (q.iterations ?? []).map((it, index) => {
      const dated = (it.weeks ?? []).map((w) => {
        const fallback = weekDates(weekCursor++);
        return { ...w, start: w.start || fallback.start, end: w.end || fallback.end };
      });
      return {
        ...it,
        weeks: dated,
        goals: Array.isArray(it.goals)
          ? it.goals.filter((g) => g && typeof g.title === "string")
          : index === 0
            ? carried
            : [],
      };
    });

    const { goal: _legacy, ...rest } = q as PlannerQuarter & { goal?: string };
    void _legacy;
    return { ...rest, iterations };
  });

  return { ...board, quarters, cells };
}

/**
 * The board's first week (I3 W1 of Q3 2026). Anchored on I3 W2 running
 * 24–30 Aug 2026, so weeks are Monday-to-Sunday and every following week
 * is the next consecutive seven days.
 */
const BOARD_START = "2026-08-17";

const DAY_MS = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Dates for the Nth week of the board, counting from BOARD_START. */
function weekDates(index: number) {
  const start = addDays(BOARD_START, index * 7);
  return { start, end: addDays(start, 6) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "17–23 Aug" within a month, "31 Aug – 6 Sep" across one. */
export function formatRange(start?: string, end?: string) {
  if (!start || !end) return "";
  const [, sm, sd] = start.split("-");
  const [, em, ed] = end.split("-");
  const from = Number(sd);
  const to = Number(ed);
  if (sm === em) return `${from}–${to} ${MONTHS[Number(sm) - 1]}`;
  return `${from} ${MONTHS[Number(sm) - 1]} – ${to} ${MONTHS[Number(em) - 1]}`;
}

/** Inclusive date span of an iteration, taken from its first and last week. */
export function iterationRange(it: PlannerIteration) {
  if (!it.weeks.length) return "";
  return formatRange(it.weeks[0].start, it.weeks[it.weeks.length - 1].end);
}

function weeks(startIndex: number, count = 3): PlannerWeek[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `w${i + 1}`,
    label: `W${i + 1}`,
    ...weekDates(startIndex + i),
  }));
}

/**
 * Default board: the timeline runs from I3 of Q3 2026 through I4 of Q2 2027,
 * and the left rail carries exactly the sections and rows from the source
 * design — nothing derived, nothing inferred.
 */
export function defaultBoard(): PlannerBoard {
  // Weeks run consecutively across the whole board, so the counter carries
  // from one iteration (and quarter) to the next.
  let cursor = 0;
  const iterations = (numbers: number[]): PlannerIteration[] =>
    numbers.map((n) => {
      const iteration: PlannerIteration = {
        key: `i${n}`,
        label: `I${n}`,
        weeks: weeks(cursor),
        goals: [],
      };
      cursor += iteration.weeks.length;
      return iteration;
    });

  return {
    quarters: [
      { key: "q3-2026", label: "Q3 2026", iterations: iterations([3, 4]) },
      { key: "q4-2026", label: "Q4 2026", iterations: iterations([1, 2, 3, 4]) },
      { key: "q1-2027", label: "Q1 2027", iterations: iterations([1, 2, 3, 4]) },
      { key: "q2-2027", label: "Q2 2027", iterations: iterations([1, 2, 3, 4]) },
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

// ── Metrics ──────────────────────────────────────────────────────────
// Two questions the board should answer at a glance: how did a given week
// go, and how close is an iteration to its goals.

/** How much credit each status earns toward "done". */
const STATUS_WEIGHT: Record<TaskStatus, number> = {
  completed: 1,
  under_review: 0.75,
  in_progress: 0.5,
  not_started: 0,
  blocked: 0,
};

export interface ProgressStats {
  total: number;
  done: number;
  blocked: number;
  /** Weighted 0–100. Null when there is nothing to measure. */
  percent: number | null;
  /** Counts per status, for the stacked bar. */
  byStatus: Record<TaskStatus, number>;
}

export function summarize(items: PlannerItem[]): ProgressStats {
  const byStatus: Record<TaskStatus, number> = {
    not_started: 0, in_progress: 0, under_review: 0, completed: 0, blocked: 0,
  };
  for (const item of items) {
    if (byStatus[item.status] === undefined) byStatus.not_started += 1;
    else byStatus[item.status] += 1;
  }
  const total = items.length;
  const weighted = items.reduce((sum, i) => sum + (STATUS_WEIGHT[i.status] ?? 0), 0);
  return {
    total,
    done: byStatus.completed,
    blocked: byStatus.blocked,
    percent: total ? Math.round((weighted / total) * 100) : null,
    byStatus,
  };
}

/** Every card sitting in one week column, across all rows. */
export function weekItems(board: PlannerBoard, columnKey: string): PlannerItem[] {
  const items: PlannerItem[] = [];
  for (const row of board.rows) {
    if (row.kind === "section") continue;
    const cell = board.cells[cellKey(row.key, columnKey)];
    if (cell) items.push(...cell);
  }
  return items;
}
