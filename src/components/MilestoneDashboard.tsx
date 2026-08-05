"use client";

import { useMemo } from "react";
import { STATUS_HEX, displayStatus, ownStatus, type Status } from "@/lib/treeStatus";
import { OWNER_STYLE } from "@/lib/constants";
import type { TreeNode } from "@/components/MilestoneTree";

type Props = {
  roots: TreeNode[];
  onOpenNode: (id: string) => void;
  onAddGoal?: (milestoneId: string) => void;
};

// Rollup helpers mirrored from MilestoneOutline / MilestoneTree — kept in sync.
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

function collectLeaves(n: TreeNode, acc: TreeNode[]): TreeNode[] {
  if (!n.children.length) acc.push(n);
  else n.children.forEach((c) => collectLeaves(c, acc));
  return acc;
}

function firstName(assignee: string | null | undefined): string | null {
  if (!assignee) return null;
  return assignee.split(" ")[0];
}

function ownerDot(name: string | null): string {
  if (!name) return "#9CA3AF";
  return OWNER_STYLE[name]?.dot || "#9CA3AF";
}

function pathTitles(roots: TreeNode[], id: string): string[] {
  const walk = (n: TreeNode, acc: string[]): string[] | null => {
    if (n.id === id) return acc;
    for (const c of n.children) {
      const r = walk(c, [...acc, n.title]);
      if (r) return r;
    }
    return null;
  };
  for (const r of roots) {
    const t = walk(r, []);
    if (t) return t;
  }
  return [];
}

type Attention =
  | { kind: "overdue"; node: TreeNode; sortKey: number }
  | { kind: "pending"; node: TreeNode; sortKey: number }
  | { kind: "recent"; node: TreeNode; sortKey: number };

const CAT_STYLE = {
  overdue:  { border: "#E24B4A", chipBg: "#FADCDA", chipFg: "#A32D2D", label: "OVERDUE" },
  pending:  { border: "#E9A100", chipBg: "#FFF4C5", chipFg: "#854F0B", label: "PENDING REVIEW" },
  recent:   { border: "#4F46E5", chipBg: "#EEF1FE", chipFg: "#4F46E5", label: "RECENT REVIEWED" },
} as const;

export default function MilestoneDashboard({ roots, onOpenNode, onAddGoal }: Props) {
  const milestone = roots[0]; // dashboard focuses on the first (only) milestone
  const allNodes = useMemo(() => {
    const acc: TreeNode[] = [];
    const walk = (n: TreeNode) => { acc.push(n); n.children.forEach(walk); };
    roots.forEach(walk);
    return acc;
  }, [roots]);

  const leaves = useMemo(() => {
    const acc: TreeNode[] = [];
    roots.forEach((r) => collectLeaves(r, acc));
    return acc;
  }, [roots]);

  const shipped = leaves.filter((l) => (l.score ?? 0) > 0 || l.attachment_count > 0).length;
  const totalLeaves = leaves.length;
  const needsReview = roots.reduce((s, r) => s + subtreePending(r), 0);
  // ApiNode carries no deadline field, so we cannot compute real overdue counts.
  const overdue = 0;
  const scored = allNodes.filter((n) => n.score != null && !n.children.length);
  const avgScore = scored.length
    ? (scored.reduce((a, n) => a + (n.score || 0), 0) / scored.length)
    : null;

  // ── Zone 2: needs attention today ────────────────────────────────────────
  const attention: Attention[] = useMemo(() => {
    const now = Date.now();
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
    const items: Attention[] = [];
    for (const l of leaves) {
      const updated = new Date(l.updated_at).getTime();
      if ((l.pending_attachment_count || 0) > 0) {
        items.push({ kind: "pending", node: l, sortKey: -updated });
      } else if (l.score != null && now - updated < THREE_DAYS) {
        items.push({ kind: "recent", node: l, sortKey: -updated });
      }
    }
    const priority: Record<Attention["kind"], number> = { overdue: 0, pending: 1, recent: 2 };
    items.sort((a, b) => priority[a.kind] - priority[b.kind] || a.sortKey - b.sortKey);
    return items.slice(0, 8);
  }, [leaves]);

  const milestoneOwner = milestone?.assignee || milestone?.owner?.full_name || null;

  return (
    <div className="space-y-4">
      {/* ── Zone 1: hero KPI strip ─────────────────────────────────────────── */}
      {milestone && (
        <div
          style={{
            background: "#FFFFFF",
            border: "0.5px solid #E8E5DC",
            borderRadius: 12,
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 200, flex: "1 1 240px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#2C2C2A", lineHeight: 1.2 }}>
              {milestone.title}
            </div>
            <div style={{ fontSize: 11.5, color: "#7A7972", marginTop: 4 }}>
              {milestoneOwner ? `Owned by ${milestoneOwner}` : "Unassigned"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: "2 1 400px" }}>
            <KpiTile bg="#EAF3DE" border="#C6DFA6" fg="#3B6D11" big={String(shipped)} label={`shipped / ${totalLeaves}`} />
            <KpiTile bg="#FFF4C5" border="#E9A100" fg="#854F0B" big={String(needsReview)} label="need review" />
            <KpiTile bg="#FADCDA" border="#E28582" fg="#A32D2D" big={String(overdue)} label="overdue" />
            <KpiTile
              bg="#F3F1E9"
              border="#D6D3C7"
              fg="#5F5E5A"
              big={avgScore != null ? avgScore.toFixed(1) : "—"}
              label="avg score"
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => onAddGoal?.(milestone.id)}
              style={{
                background: "#4F46E5",
                color: "#FFFFFF",
                border: "none",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Add Goal
            </button>
            <span
              style={{
                fontSize: 10.5,
                color: "#7A7972",
                border: "0.5px solid #E8E5DC",
                background: "#FBFAF5",
                borderRadius: 999,
                padding: "3px 8px",
              }}
            >
              ⌘K
            </span>
          </div>
        </div>
      )}

      {/* ── Zone 2: needs attention today ──────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 10, letterSpacing: 1.2, color: "#7A7972", fontWeight: 700, marginBottom: 8 }}>
          NEEDS ATTENTION TODAY
        </div>
        {attention.length === 0 ? (
          <div style={{ fontSize: 12, color: "#9B9A93", fontStyle: "italic" }}>
            Nothing needs your attention right now.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 10,
            }}
          >
            {attention.map((a) => {
              const s = CAT_STYLE[a.kind];
              const owner = firstName(a.node.assignee || a.node.owner?.full_name || null);
              const trail = pathTitles(roots, a.node.id).join(" › ");
              return (
                <div
                  key={a.node.id}
                  onClick={() => onOpenNode(a.node.id)}
                  style={{
                    background: "#FFFEF9",
                    borderRadius: 10,
                    borderLeft: `3px solid ${s.border}`,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                    padding: "12px 14px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: 0.6,
                        padding: "2px 6px",
                        borderRadius: 6,
                        background: s.chipBg,
                        color: s.chipFg,
                      }}
                    >
                      {s.label}
                    </span>
                    <span style={{ fontSize: 10, color: "#9B9A93" }}>
                      {formatRelative(a.node.updated_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#2C2C2A", lineHeight: 1.3 }}>
                    {a.node.title}
                  </div>
                  <div style={{ fontSize: 10.5, color: "#7A7972" }}>
                    {owner || "unassigned"} · {trail || "—"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Zone 3: goals grid ─────────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 10, letterSpacing: 1.2, color: "#7A7972", fontWeight: 700, marginBottom: 8 }}>
          GOALS
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 12,
          }}
        >
          {(milestone?.children || []).map((g) => (
            <GoalCard key={g.id} goal={g} onOpen={onOpenNode} />
          ))}
          {milestone && (
            <button
              type="button"
              onClick={() => onAddGoal?.(milestone.id)}
              style={{
                background: "transparent",
                border: "1px dashed #C4C1B6",
                borderRadius: 12,
                padding: "14px 16px",
                minHeight: 120,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#7A7972",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              + Add another Goal to this milestone
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiTile({ bg, border, fg, big, label }: {
  bg: string; border: string; fg: string; big: string; label: string;
}) {
  return (
    <div
      style={{
        background: bg,
        border: `0.5px solid ${border}`,
        borderRadius: 10,
        padding: "8px 12px",
        minWidth: 100,
        flex: "1 1 100px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: fg, lineHeight: 1.1 }}>{big}</div>
      <div style={{ fontSize: 10.5, color: fg, opacity: 0.85, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function GoalCard({ goal, onOpen }: { goal: TreeNode; onOpen: (id: string) => void }) {
  const disp = displayStatus(goal);
  const own = ownStatus(goal);
  const { touched, total } = countTouched(goal);
  const pct = total > 0 ? Math.round((touched / total) * 100) : 0;
  const directPending = directPendingKidCount(goal);
  const pendingBelow = subtreePending(goal) - (goal.pending_attachment_count || 0);
  const owner = firstName(goal.assignee || goal.owner?.full_name || null);

  // Leaf-level "late" — no deadline data available, so this is 0 for now.
  const late = 0;

  return (
    <div
      onClick={() => onOpen(goal.id)}
      style={{
        background: "#FFFFFF",
        border: "0.5px solid #E8E5DC",
        borderRadius: 12,
        padding: "14px 16px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 10, height: 10, borderRadius: "50%",
            background: STATUS_HEX[disp as Status], flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#2C2C2A", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {goal.title}
        </span>
        <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}>
          {directPending > 0 && (
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 8,
              background: "#E9A100", color: "#FFFFFF", letterSpacing: 0.3,
            }}>
              {directPending} NEW
            </span>
          )}
          {directPending === 0 && pendingBelow > 0 && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
              background: "transparent", color: "#A87700", border: "1px dashed #D6B84A",
            }}>
              {pendingBelow} below
            </span>
          )}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#7A7972" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: ownerDot(owner) }} />
          {owner || "unassigned"}
        </span>
        <span>{touched} / {total} shipped</span>
        {late > 0 && <span style={{ color: "#A32D2D" }}>{late} late</span>}
      </div>

      <div style={{ height: 4, background: "#F3F1E9", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: STATUS_HEX[disp as Status] }} />
      </div>

      {goal.children.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          {goal.children.map((sub) => {
            const { touched: t, total: tot } = countTouched(sub);
            return (
              <span
                key={sub.id}
                onClick={(e) => { e.stopPropagation(); onOpen(sub.id); }}
                style={{
                  fontSize: 10.5,
                  padding: "3px 8px",
                  background: "#FBFAF5",
                  border: "0.5px solid #E8E5DC",
                  borderRadius: 999,
                  color: "#5F5E5A",
                  cursor: "pointer",
                  display: "inline-flex",
                  gap: 4,
                  alignItems: "center",
                }}
                title={sub.title}
              >
                {sub.title}
                <b style={{ color: "#2C2C2A" }}>{t}/{tot}</b>
              </span>
            );
          })}
        </div>
      )}
      {own !== disp && null}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
