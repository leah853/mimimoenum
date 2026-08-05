"use client";

import { useMemo, useState } from "react";
import { ownStatus, displayStatus, STATUS_HEX, type Status } from "@/lib/treeStatus";
import { OWNER_STYLE } from "@/lib/constants";
import type { TreeNode, Kind } from "@/components/MilestoneTree";

type Props = {
  roots: TreeNode[];
  onOpenNode: (id: string) => void;
};

const KIND_LABEL: Record<Kind, string> = {
  Milestone: "MS",
  Goal: "GOAL",
  "Sub-goal": "SUB",
  Task: "TASK",
  "Sub-task": "SUB-TASK",
};

const KIND_INDENT: Record<Kind, number> = {
  Milestone: 0,
  Goal: 22,
  "Sub-goal": 46,
  Task: 70,
  "Sub-task": 94,
};

const STATUS_LABEL: Record<Status, string> = {
  grey: "Not started",
  black: "Awaiting review",
  red: "Needs work",
  yellow: "In progress",
  green: "Shipped",
};

function subtreePending(n: TreeNode): number {
  let s = n.pending_attachment_count || 0;
  for (const c of n.children) s += subtreePending(c);
  return s;
}

function directPendingKidCount(n: TreeNode): number {
  return n.children.reduce((acc, c) => acc + ((c.pending_attachment_count || 0) > 0 ? 1 : 0), 0);
}

function countTouched(n: TreeNode): { touched: number; total: number } {
  const all: TreeNode[] = [];
  const walk = (x: TreeNode) => { x.children.forEach((c) => { all.push(c); walk(c); }); };
  walk(n);
  const touched = all.filter((x) => x.score != null || x.attachment_count > 0).length;
  return { touched, total: all.length };
}

function collectIds(n: TreeNode, out: string[]): string[] {
  out.push(n.id);
  n.children.forEach((c) => collectIds(c, out));
  return out;
}

function matches(n: TreeNode, q: string): boolean {
  if (!q) return true;
  return n.title.toLowerCase().includes(q);
}

function anyDescMatches(n: TreeNode, q: string): boolean {
  if (matches(n, q)) return true;
  return n.children.some((c) => anyDescMatches(c, q));
}

export default function MilestoneOutline({ roots, onOpenNode }: Props) {
  const allIds = useMemo(() => {
    const acc: string[] = [];
    roots.forEach((r) => collectIds(r, acc));
    return acc;
  }, [roots]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const toggleId = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allIds));

  type Row = { node: TreeNode; depth: number; hasKids: boolean; isCollapsed: boolean };
  const rows: Row[] = [];
  const walk = (n: TreeNode, depth: number) => {
    if (q && !anyDescMatches(n, q)) return;
    const hasKids = n.children.length > 0;
    const isCollapsed = collapsed.has(n.id) && !q;
    rows.push({ node: n, depth, hasKids, isCollapsed });
    if (hasKids && !isCollapsed) {
      n.children.forEach((c) => walk(c, depth + 1));
    }
  };
  roots.forEach((r) => walk(r, 0));

  return (
    <div className="bg-white/80 dark:bg-gray-900/60 border border-gray-200/60 dark:border-gray-800/60 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-200/60 dark:border-gray-800/60 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={expandAll}
            className="text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Collapse all
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter titles…"
          className="text-[12px] px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 w-56"
        />
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid text-[11px] uppercase tracking-wider text-gray-500 bg-gray-50/70 dark:bg-gray-800/40 sticky top-0 border-b border-gray-200/60 dark:border-gray-800/60"
          style={{ gridTemplateColumns: "minmax(320px,1fr) 120px 180px 90px 60px" }}
        >
          <div className="px-3 py-2">Name</div>
          <div className="px-3 py-2">Owner</div>
          <div className="px-3 py-2">Progress</div>
          <div className="px-3 py-2">Deadline</div>
          <div className="px-3 py-2 text-right">Score</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-400 italic">
            No matches.
          </div>
        ) : (
          rows.map((r) => (
            <OutlineRow key={r.node.id} row={r} onOpen={onOpenNode} onToggle={toggleId} />
          ))
        )}
      </div>
    </div>
  );
}

function OutlineRow({
  row,
  onOpen,
  onToggle,
}: {
  row: { node: TreeNode; depth: number; hasKids: boolean; isCollapsed: boolean };
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { node, hasKids, isCollapsed } = row;
  const indent = KIND_INDENT[node.kind] ?? 0;

  const own = ownStatus(node);
  const disp = displayStatus(node);
  const isLeaf = node.children.length === 0;
  const barColor = STATUS_HEX[disp];
  const scoreStatus = own === "red" || own === "yellow" || own === "green" ? own : null;

  const hasPendingHere = (node.pending_attachment_count || 0) > 0;
  const pendingBelow = subtreePending(node) - (node.pending_attachment_count || 0);
  const newDirectKids = hasKids ? directPendingKidCount(node) : 0;
  const progress = hasKids ? countTouched(node) : null;

  const rowBg = hasPendingHere
    ? "#FFF4C5"
    : node.kind === "Milestone"
      ? "#FFFEF9"
      : "transparent";

  const assignee = node.assignee || node.owner?.full_name || null;
  const firstName = assignee ? assignee.split(" ")[0] : null;
  const ownerDot = assignee && OWNER_STYLE[firstName as string]?.dot;

  return (
    <div
      onClick={() => onOpen(node.id)}
      className="grid items-center border-b border-gray-100 dark:border-gray-800/60 hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10 cursor-pointer"
      style={{ gridTemplateColumns: "minmax(320px,1fr) 120px 180px 90px 60px", background: rowBg }}
    >
      <div className="px-3 py-2 flex items-center gap-2 min-w-0" style={{ paddingLeft: 12 + indent }}>
        {hasKids ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700 flex-shrink-0"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            <span style={{ fontSize: 10, lineHeight: 1 }}>{isCollapsed ? "▶" : "▼"}</span>
          </button>
        ) : (
          <span className="w-4 h-4 flex-shrink-0" />
        )}
        <span
          className="text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: "#F1EFE8", color: "#5F5E5A", letterSpacing: 0.4 }}
        >
          {KIND_LABEL[node.kind]}
        </span>
        <span
          className="text-[13px] text-gray-800 dark:text-gray-100 truncate min-w-0"
          style={{ fontWeight: node.kind === "Milestone" ? 700 : node.kind === "Goal" ? 600 : 500 }}
          title={node.title}
        >
          {node.title}
        </span>
        {node.attachment_count > 0 && (
          <span className="text-[10.5px] text-gray-500 flex items-center gap-0.5 flex-shrink-0" title="attachments">
            <span>📎</span>
            <span>{node.attachment_count}</span>
          </span>
        )}
        {hasKids && newDirectKids > 0 && (
          <span
            className="flex-shrink-0"
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              padding: "1px 6px",
              borderRadius: 8,
              background: "#E9A100",
              color: "#FFFFFF",
              letterSpacing: 0.3,
            }}
            title={`${newDirectKids} direct children with pending review`}
          >
            {newDirectKids} NEW
          </span>
        )}
        {hasKids && pendingBelow > 0 && (
          <span
            className="flex-shrink-0"
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 8,
              background: "transparent",
              color: "#A87700",
              border: "1px dashed #D6B84A",
            }}
            title={`${pendingBelow} pending review in subtree`}
          >
            {pendingBelow} below
          </span>
        )}
      </div>

      <div className="px-3 py-2 flex items-center gap-2 min-w-0 text-[12px] text-gray-700 dark:text-gray-300">
        {assignee ? (
          <>
            <span
              className="inline-block rounded-full flex-shrink-0"
              style={{ width: 8, height: 8, background: ownerDot || "#9CA3AF" }}
            />
            <span className="truncate">{firstName}</span>
          </>
        ) : (
          <span className="text-gray-400 italic">unassigned</span>
        )}
      </div>

      <div className="px-3 py-1.5 min-w-0">
        {isLeaf ? (
          <span
            className="text-[11px] font-medium"
            style={{ color: STATUS_HEX[own] }}
          >
            {STATUS_LABEL[own]}
          </span>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="w-full rounded-full overflow-hidden" style={{ height: 5, background: "#E7E5DC" }}>
              <div
                style={{
                  width: progress && progress.total > 0
                    ? `${Math.round((progress.touched / progress.total) * 100)}%`
                    : "0%",
                  height: "100%",
                  background: barColor,
                }}
              />
            </div>
            <span className="text-[10.5px] text-gray-500">
              {progress?.touched ?? 0} / {progress?.total ?? 0} shipped
            </span>
          </div>
        )}
      </div>

      <div className="px-3 py-2 text-[11.5px] text-gray-400">
        —
      </div>

      <div className="px-3 py-2 text-right">
        {node.score != null && scoreStatus ? (
          <span
            className="inline-block text-[11px] font-bold rounded-md px-1.5 py-0.5"
            style={{ background: STATUS_HEX[scoreStatus], color: "#FFFFFF" }}
          >
            {node.score}/10
          </span>
        ) : (
          <span className="text-[11px] text-gray-300">—</span>
        )}
      </div>
    </div>
  );
}
