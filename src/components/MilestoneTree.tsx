"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useApi, apiPost, apiPatch, apiDelete, invalidateCache } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { useToast, SkeletonRows } from "@/components/ui";
import { handleApiError } from "@/lib/utils";
import { displayStatus, ownStatus, STATUS_HEX, type Status } from "@/lib/treeStatus";
import {
  HiX,
  HiOutlinePaperClip,
  HiOutlineDownload,
  HiOutlineTrash,
} from "react-icons/hi";

// ─── Types ───────────────────────────────────────────────────────────────────
type Kind = "Milestone" | "Goal" | "Sub-goal" | "Task";

type ApiNode = {
  id: string;
  parent_id: string | null;
  owner_id: string;
  title: string;
  kind: Kind;
  assignee: string | null;
  score: number | null;
  sort_order: number;
  collapsed: boolean;
  created_at: string;
  updated_at: string;
  owner?: { id: string; full_name: string };
  feedback_count: number;
  attachment_count: number;
};

type TreeNode = ApiNode & {
  children: TreeNode[];
  attachmentCount: number; // alias for treeStatus lib
};

type Feedback = { id: string; author: string; body: string; created_at: string };
type Attachment = {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  uploaded_at: string;
};

// ─── Card + layout constants ────────────────────────────────────────────────
// Reference values were NODE_W=176, NODE_H=58, H_GAP=26, V_GAP=72. Tightened
// slightly because Milestone 1's real tree has ~34 leaf nodes at depth 6 —
// with the reference values the canvas is ~4000px wide and spills off any
// reasonable screen. The pine visual survives compaction fine.
const NODE_W = 156;
const NODE_H = 54;
const H_GAP = 14;
const V_GAP = 56;
const TRUNK = 70;

const COLORS: Record<
  Status,
  { bar: string; dot: string; text: string; pill: string; pillText: string }
> = {
  grey: { bar: "#B4B2A9", dot: "#D3D1C7", text: "#5F5E5A", pill: "#F1EFE8", pillText: "#5F5E5A" },
  black: { bar: "#2C2C2A", dot: "#2C2C2A", text: "#2C2C2A", pill: "#E7E5DE", pillText: "#2C2C2A" },
  red: { bar: "#E24B4A", dot: "#E24B4A", text: "#A32D2D", pill: "#FCEBEB", pillText: "#A32D2D" },
  yellow: { bar: "#EF9F27", dot: "#EF9F27", text: "#854F0B", pill: "#FAEEDA", pillText: "#854F0B" },
  green: { bar: "#639922", dot: "#639922", text: "#3B6D11", pill: "#EAF3DE", pillText: "#3B6D11" },
};

const KINDS: Kind[] = ["Milestone", "Goal", "Sub-goal", "Task"];

// ─── Tree assembly from flat rows ────────────────────────────────────────────
function byOrder(a: ApiNode, b: ApiNode) {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

function buildRoots(flat: ApiNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const n of flat) {
    map.set(n.id, { ...n, children: [], attachmentCount: n.attachment_count });
  }
  const roots: TreeNode[] = [];
  for (const n of flat) {
    const node = map.get(n.id)!;
    if (n.parent_id && map.has(n.parent_id)) {
      map.get(n.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (list: TreeNode[]) => {
    list.sort(byOrder);
    for (const c of list) sortRec(c.children);
  };
  sortRec(roots);
  return roots;
}

// ─── Layout: pine — milestone tip at top, fans down, trunk to base ──────────
type Positions = Record<string, { x: number; y: number; depth: number }>;

function layout(root: TreeNode): { positions: Positions; width: number; height: number; maxDepth: number } {
  const positions: Positions = {};
  let cursorX = 0;
  let maxDepth = 0;
  const place = (node: TreeNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const visibleKids = node.collapsed ? [] : node.children;
    if (!visibleKids.length) {
      const x = cursorX;
      cursorX += NODE_W + H_GAP;
      positions[node.id] = { x, y: 10 + depth * (NODE_H + V_GAP), depth };
      return x + NODE_W / 2;
    }
    const centers = visibleKids.map((c) => place(c, depth + 1));
    const mid = (centers[0] + centers[centers.length - 1]) / 2;
    positions[node.id] = { x: mid - NODE_W / 2, y: 10 + depth * (NODE_H + V_GAP), depth };
    return mid;
  };
  place(root, 0);
  let maxX = 0;
  let maxY = 0;
  Object.values(positions).forEach((p) => {
    maxX = Math.max(maxX, p.x + NODE_W);
    maxY = Math.max(maxY, p.y + NODE_H);
  });
  return { positions, width: maxX, height: maxY + TRUNK, maxDepth };
}

function flatten(node: TreeNode, acc: TreeNode[]): TreeNode[] {
  acc.push(node);
  if (!node.collapsed) node.children.forEach((c) => flatten(c, acc));
  return acc;
}

function subtreeCount(node: TreeNode): number {
  let c = 0;
  node.children.forEach((k) => { c += 1 + subtreeCount(k); });
  return c;
}

function collectScoresLocal(n: TreeNode, out: number[]): number[] {
  if (n.score != null) out.push(n.score);
  n.children.forEach((c) => collectScoresLocal(c, out));
  return out;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function MilestoneTree() {
  const { data: apiNodes, loading, refetch } = useApi<ApiNode[]>("/api/milestone-nodes");
  const { dbUser, appRole } = useAuth();
  const { toast } = useToast();
  const isDoer = appRole === "doer" || appRole === "admin";

  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const [createUnder, setCreateUnder] = useState<{ parentId: string | null; kind: Kind } | null>(null);

  const roots = useMemo(() => buildRoots(apiNodes || []), [apiNodes]);
  const openNode = useMemo(() => {
    if (!openNodeId) return null;
    const scan = (list: TreeNode[]): TreeNode | null => {
      for (const n of list) {
        if (n.id === openNodeId) return n;
        const c = scan(n.children);
        if (c) return c;
      }
      return null;
    };
    return scan(roots);
  }, [openNodeId, roots]);

  async function toggleCollapse(id: string) {
    const scan = (list: TreeNode[]): TreeNode | null => {
      for (const n of list) {
        if (n.id === id) return n;
        const c = scan(n.children);
        if (c) return c;
      }
      return null;
    };
    const n = scan(roots);
    if (!n) return;
    try {
      await apiPatch(`/api/milestone-nodes/${id}`, { collapsed: !n.collapsed });
      invalidateCache("/api/milestone-nodes");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function updateNode(id: string, patch: Partial<ApiNode>) {
    try {
      await apiPatch(`/api/milestone-nodes/${id}`, patch);
      invalidateCache("/api/milestone-nodes");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function deleteNode(id: string) {
    if (!confirm("Delete this node and all its children (including attachments)?")) return;
    try {
      await apiDelete(`/api/milestone-nodes/${id}`);
      if (openNodeId === id) setOpenNodeId(null);
      invalidateCache("/api/milestone-nodes");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function createChild(parentId: string | null, kind: Kind, title: string) {
    if (!title.trim()) return;
    try {
      // sort_order = number of existing siblings at the target level
      let siblings: TreeNode[];
      if (parentId) {
        const scan = (list: TreeNode[]): TreeNode | null => {
          for (const n of list) {
            if (n.id === parentId) return n;
            const c = scan(n.children);
            if (c) return c;
          }
          return null;
        };
        siblings = scan(roots)?.children || [];
      } else {
        siblings = roots;
      }
      await apiPost("/api/milestone-nodes", {
        parent_id: parentId,
        kind,
        title: title.trim(),
        sort_order: siblings.length,
      });
      setCreateUnder(null);
      invalidateCache("/api/milestone-nodes");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function seedSampleTree() {
    if (!confirm("Load the Milestone 1 sample tree? Only works if the tree is currently empty.")) return;
    try {
      const res = await fetch("/api/milestone-nodes/seed", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast(`Seeded ${json.inserted} nodes`, "success");
      invalidateCache("/api/milestone-nodes");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  if (loading) return <div className="mt-6"><SkeletonRows count={6} /></div>;

  return (
    <div className="mt-4 space-y-6">
      {/* Legend header — color meanings + rollup caption */}
      <div className="flex items-center flex-wrap gap-x-5 gap-y-2 px-4 py-2 bg-white/70 dark:bg-gray-900/60 border border-gray-200/60 dark:border-gray-800/60 rounded-xl text-[11.5px]">
        <span className="font-semibold text-gray-700 dark:text-gray-300">Legend</span>
        {(
          [
            ["grey", "untouched"],
            ["black", "has link"],
            ["red", "≤5"],
            ["yellow", "6–8"],
            ["green", "9+"],
          ] as const
        ).map(([k, l]) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
            <span
              className="inline-block rounded-sm"
              style={{ width: 11, height: 11, background: STATUS_HEX[k as Status] }}
            />
            {l}
          </span>
        ))}
        <span className="text-gray-400 italic">parent color = worst child</span>
      </div>

      {roots.length === 0 ? (
        <div className="bg-white/80 dark:bg-gray-900/80 border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-8 text-center space-y-3">
          <p className="text-sm text-gray-500">No milestones yet. Plant one to grow the tree.</p>
          {isDoer && (
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={() => setCreateUnder({ parentId: null, kind: "Milestone" })}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm rounded-xl shadow-md hover:brightness-110 transition-all"
              >
                + Create first Milestone
              </button>
              <button
                onClick={seedSampleTree}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-indigo-600 text-sm border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-all"
              >
                Load Milestone 1 sample tree
              </button>
            </div>
          )}
        </div>
      ) : (
        roots.map((root) => (
          <PineCanvas
            key={root.id}
            root={root}
            onOpen={setOpenNodeId}
            onToggle={toggleCollapse}
            onAdd={(parentId) => {
              const kind = defaultChildKind(root, parentId);
              setCreateUnder({ parentId, kind });
            }}
          />
        ))
      )}

      {isDoer && roots.length > 0 && !createUnder && (
        <div className="text-center">
          <button
            onClick={() => setCreateUnder({ parentId: null, kind: "Milestone" })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-indigo-600 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 rounded-lg transition-all"
          >
            + Plant another Milestone
          </button>
        </div>
      )}

      {createUnder && (
        <CreateNodeModal
          parentId={createUnder.parentId}
          initialKind={createUnder.kind}
          onCancel={() => setCreateUnder(null)}
          onCreate={createChild}
        />
      )}

      {openNode && (
        <NodeModal
          node={openNode}
          path={findPath(roots, openNode.id)}
          currentUser={dbUser}
          isDoer={isDoer}
          onClose={() => setOpenNodeId(null)}
          onUpdate={updateNode}
          onDelete={deleteNode}
          onRefetchTree={refetch}
        />
      )}
    </div>
  );
}

/** Titles of every ancestor down to (but not including) the target node. */
function findPath(roots: TreeNode[], id: string): string[] {
  for (const r of roots) {
    const trail = walk(r, id, []);
    if (trail) return trail;
  }
  return [];
}
function walk(node: TreeNode, id: string, acc: string[]): string[] | null {
  if (node.id === id) return acc;
  for (const c of node.children) {
    const r = walk(c, id, [...acc, node.title]);
    if (r) return r;
  }
  return null;
}

function defaultChildKind(root: TreeNode, parentId: string | null): Kind {
  if (!parentId) return "Milestone";
  const scan = (n: TreeNode): TreeNode | null => {
    if (n.id === parentId) return n;
    for (const c of n.children) {
      const r = scan(c);
      if (r) return r;
    }
    return null;
  };
  const parent = scan(root);
  if (!parent) return "Goal";
  if (parent.kind === "Milestone") return "Goal";
  if (parent.kind === "Goal") return "Sub-goal";
  return "Task";
}

// ─── The pine canvas: ambient backdrop + trunk/limbs/leaves + node cards ────
// Wraps the raw pine in an auto-fit-to-width scaler so 60+ node trees don't
// spill off the viewport. Users can override with the zoom controls.
type ZoomMode = "fit" | "actual" | number;

function PineCanvas({
  root,
  onOpen,
  onToggle,
  onAdd,
}: {
  root: TreeNode;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (parentId: string) => void;
}) {
  const { positions, width, height } = useMemo(() => layout(root), [root]);
  const nodes = useMemo(() => flatten(root, []), [root]);
  const PAD = 40;

  const outerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");

  useEffect(() => {
    if (!outerRef.current) return;
    const el = outerRef.current;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const canvasW = width + PAD;
  const canvasH = height + PAD;
  const fitScale =
    containerW > 0 && canvasW > containerW ? Math.max(0.35, containerW / canvasW) : 1;
  const scale =
    zoomMode === "fit"
      ? fitScale
      : zoomMode === "actual"
        ? 1
        : (zoomMode as number);
  const scaledH = canvasH * scale;
  const scaledW = canvasW * scale;

  const zoomPct = Math.round(scale * 100);

  return (
    <div ref={outerRef} style={{ background: "#F7F5EF", borderRadius: 12, padding: 12 }}>
      {/* Zoom toolbar */}
      <div className="flex items-center justify-end gap-1.5 mb-2 text-[11px]">
        <button
          onClick={() => setZoomMode("fit")}
          className={`px-2 py-0.5 rounded-md border ${
            zoomMode === "fit"
              ? "bg-indigo-500 text-white border-indigo-500"
              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
          }`}
        >
          Fit
        </button>
        <button
          onClick={() => setZoomMode("actual")}
          className={`px-2 py-0.5 rounded-md border ${
            zoomMode === "actual"
              ? "bg-indigo-500 text-white border-indigo-500"
              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
          }`}
        >
          100%
        </button>
        <button
          onClick={() => setZoomMode(Math.max(0.25, scale - 0.1))}
          className="px-1.5 py-0.5 rounded-md border bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
        >
          −
        </button>
        <span className="w-10 text-center text-gray-500 tabular-nums">{zoomPct}%</span>
        <button
          onClick={() => setZoomMode(Math.min(2, scale + 0.1))}
          className="px-1.5 py-0.5 rounded-md border bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
        >
          +
        </button>
      </div>

      {/* Scaled canvas — wrapper reserves scaled-size so scroll works when zoomed in */}
      <div style={{ overflow: "auto", padding: PAD - 12 }}>
        <div style={{ width: scaledW, height: scaledH, position: "relative" }}>
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              width: canvasW,
              height: canvasH,
              position: "absolute",
              left: 0,
              top: 0,
            }}
          >
      <div style={{ position: "relative", width: width + PAD, height: height + PAD }}>
        {/* Ambient backdrop: canopy + ground gradients + soft corner foliage */}
        <svg
          width={width + PAD}
          height={height + PAD}
          style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id={`canopy-${root.id}`} cx="50%" cy="14%" r="60%">
              <stop offset="0%" stopColor="#CFE0D2" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#CFE0D2" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`ground-${root.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E4DCCB" stopOpacity="0" />
              <stop offset="100%" stopColor="#E4DCCB" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width={width + PAD} height={height + PAD} fill={`url(#canopy-${root.id})`} />
          <rect
            x="0"
            y={(height + PAD) * 0.62}
            width={width + PAD}
            height={(height + PAD) * 0.38}
            fill={`url(#ground-${root.id})`}
          />
          {(() => {
            const W = width + PAD;
            const H = height + PAD;
            const blob = (cx: number, cy: number, rx: number, ry: number, rot: number, op: number) => (
              <ellipse
                key={`${cx}-${cy}`}
                cx={cx}
                cy={cy}
                rx={rx}
                ry={ry}
                fill="#9FC0A8"
                opacity={op}
                transform={`rotate(${rot} ${cx} ${cy})`}
              />
            );
            return [
              blob(28, H * 0.2, 46, 28, -18, 0.14),
              blob(W - 30, H * 0.16, 52, 30, 22, 0.13),
              blob(18, H * 0.55, 38, 24, 10, 0.1),
              blob(W - 20, H * 0.5, 44, 26, -14, 0.1),
              blob(40, H * 0.85, 40, 22, -8, 0.08),
              blob(W - 44, H * 0.82, 40, 24, 12, 0.08),
            ];
          })()}
        </svg>

        {/* Trunk + forking limbs + leaf clusters */}
        <svg
          width={width + PAD}
          height={height + PAD}
          style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
        >
          {(() => {
            const limbs: React.ReactNode[] = [];
            const BARK = "#8A6A4A";
            const BARK_D = "#6E5238";
            const widthAt = (depth: number) => Math.max(3.5, 13 - depth * 3);
            const rootP = positions[root.id];

            // Central trunk: descends from the milestone tip to the base of
            // the canvas, thickening as it goes.
            if (rootP) {
              const cx = rootP.x + NODE_W / 2;
              const topY = rootP.y + NODE_H / 2;
              const baseY = height + PAD - 18;
              const topH = widthAt(0) / 2;
              const baseH = 15;
              limbs.push(
                <path
                  key="trunk"
                  d={`M${cx - topH},${topY} L${cx - baseH},${baseY} Q${cx},${baseY + 10} ${cx + baseH},${baseY} L${cx + topH},${topY} Z`}
                  fill={BARK_D}
                />,
              );
            }

            // Forking tapered branches from each parent card bottom to child top.
            nodes.forEach((n) => {
              if (n.collapsed) return;
              const p = positions[n.id];
              const w1 = widthAt(p.depth);
              n.children.forEach((c) => {
                const cp = positions[c.id];
                if (!cp) return;
                const x1 = p.x + NODE_W / 2;
                const y1 = p.y + NODE_H;
                const x2 = cp.x + NODE_W / 2;
                const y2 = cp.y;
                const w2 = widthAt(cp.depth);
                const my = (y1 + y2) / 2;
                const h1 = w1 / 2;
                const h2 = w2 / 2;
                const d =
                  `M${x1 - h1},${y1} ` +
                  `C${x1 - h1},${my} ${x2 - h2},${my} ${x2 - h2},${y2} ` +
                  `L${x2 + h2},${y2} ` +
                  `C${x2 + h2},${my} ${x1 + h1},${my} ${x1 + h1},${y1} Z`;
                limbs.push(<path key={n.id + c.id} d={d} fill={BARK} />);
                limbs.push(<circle key={n.id + c.id + "j"} cx={x1} cy={y1} r={h1} fill={BARK} />);
              });
            });

            // Foliage clusters on childless visible nodes.
            nodes.forEach((n) => {
              if (n.collapsed) return;
              if (n.children && n.children.length) return;
              const p = positions[n.id];
              const bx = p.x + NODE_W / 2;
              const by = p.y + NODE_H + 6;
              const leaf = (dx: number, dy: number, r: number, rot: number, fill: string, op: number) => (
                <ellipse
                  key={`${n.id}lf${dx}${dy}`}
                  cx={bx + dx}
                  cy={by + dy}
                  rx={r}
                  ry={r * 0.62}
                  fill={fill}
                  opacity={op}
                  transform={`rotate(${rot} ${bx + dx} ${by + dy})`}
                />
              );
              limbs.push(leaf(-18, 4, 13, -28, "#8FB98C", 0.9));
              limbs.push(leaf(0, 9, 15, 8, "#7FAE7C", 0.9));
              limbs.push(leaf(18, 4, 13, 30, "#9CC499", 0.9));
              limbs.push(leaf(-8, 15, 11, -12, "#88B585", 0.85));
              limbs.push(leaf(9, 15, 11, 18, "#93BE90", 0.85));
            });

            return limbs;
          })()}
        </svg>

        {nodes.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            pos={positions[n.id]}
            hasKids={n.children.length > 0}
            onOpen={onOpen}
            onToggle={onToggle}
            onAdd={onAdd}
          />
        ))}
      </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Node card (ported verbatim from reference, adapted to Supabase fields) ─
function NodeCard({
  node,
  pos,
  hasKids,
  onOpen,
  onToggle,
  onAdd,
}: {
  node: TreeNode;
  pos: { x: number; y: number; depth: number };
  hasKids: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (parentId: string) => void;
}) {
  const disp = displayStatus(node);
  const own = ownStatus(node);
  const c = COLORS[disp];
  const rolledUp = hasKids && own !== disp;
  const assignee = node.assignee || node.owner?.full_name || null;
  const hasAtt = node.attachment_count > 0;
  const isMilestone = node.kind === "Milestone";
  const isGoal = node.kind === "Goal";
  const isTask = node.kind === "Task";

  // Kind-driven typography — Milestone reads as the anchor, Task the leaf.
  const titleSize = isMilestone ? 14 : isGoal ? 13.5 : isTask ? 12.5 : 13;
  const titleWeight = isMilestone ? 700 : isGoal ? 600 : 500;
  const cardBg = isMilestone ? "#FFFEF9" : "#FFFFFF";

  return (
    <div
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: NODE_W,
        height: NODE_H,
        background: cardBg,
        borderRadius: 12,
        border: "0.5px solid #E4E1D8",
        borderTop: `3px solid ${c.bar}`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "6px 10px",
        cursor: "pointer",
        boxShadow: isMilestone
          ? "0 2px 6px rgba(0,0,0,0.06)"
          : "0 1px 2px rgba(0,0,0,0.03)",
        transition: "box-shadow .15s, transform .15s",
      }}
      onClick={() => onOpen(node.id)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span
          style={{
            fontSize: 8.5,
            fontWeight: 600,
            letterSpacing: 0.5,
            padding: "1px 5px",
            borderRadius: 4,
            background: c.pill,
            color: c.pillText,
            flexShrink: 0,
            textTransform: "uppercase",
          }}
        >
          {node.kind === "Sub-goal" ? "SUB" : node.kind === "Milestone" ? "MS" : node.kind === "Goal" ? "GOAL" : "TASK"}
        </span>
        <span
          style={{
            fontSize: titleSize,
            fontWeight: titleWeight,
            color: "#2C2C2A",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {node.title}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 3,
          fontSize: 10.5,
          color: "#8A897F",
          minWidth: 0,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: assignee ? "#E7EDF3" : "#F0EEE7",
              color: assignee ? "#185FA5" : "#A8A69C",
              fontSize: 8,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontWeight: 600,
            }}
          >
            {assignee ? assignee[0].toUpperCase() : "—"}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {assignee || "unassigned"}
          </span>
        </span>
        {hasAtt && (
          <span title="has attachment" style={{ color: "#8A897F", flexShrink: 0 }}>
            📎
          </span>
        )}
        {node.score != null && (
          <span
            style={{
              background: c.pill,
              color: c.pillText,
              borderRadius: 8,
              padding: "0 6px",
              fontSize: 10,
              fontWeight: 700,
              flexShrink: 0,
              lineHeight: "16px",
            }}
          >
            {node.score}
          </span>
        )}
      </div>
      {rolledUp && (
        <span
          title="color rolled up from worst child"
          style={{
            position: "absolute",
            top: -9,
            right: 8,
            background: c.bar,
            color: "#fff",
            fontSize: 9,
            borderRadius: 8,
            padding: "1px 6px",
          }}
        >
          worst {Math.min(...collectScoresLocal(node, []))}
        </span>
      )}
      {hasKids && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.id);
          }}
          style={{
            position: "absolute",
            bottom: -12,
            left: NODE_W / 2 - 11,
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: "0.5px solid #D3D1C7",
            background: "#fff",
            cursor: "pointer",
            fontSize: 12,
            lineHeight: "20px",
            color: "#5F5E5A",
            padding: 0,
            zIndex: 2,
          }}
        >
          {node.collapsed ? `+${subtreeCount(node)}` : "–"}
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAdd(node.id);
        }}
        title="add child"
        style={{
          position: "absolute",
          bottom: -12,
          right: 6,
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: "0.5px dashed #C7C4BA",
          background: "#fff",
          cursor: "pointer",
          fontSize: 13,
          lineHeight: "18px",
          color: "#8A897F",
          padding: 0,
          zIndex: 2,
        }}
      >
        +
      </button>
    </div>
  );
}

// ─── Node modal (edit / feedback / attachments) ──────────────────────────────
function NodeModal({
  node,
  path,
  currentUser,
  isDoer,
  onClose,
  onUpdate,
  onDelete,
  onRefetchTree,
}: {
  node: TreeNode;
  path: string[];
  currentUser: { id: string; full_name: string; email: string } | null;
  isDoer: boolean;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<ApiNode>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefetchTree: () => Promise<unknown>;
}) {
  const { toast } = useToast();
  const { data: feedback, refetch: refetchFeedback } = useApi<Feedback[]>(
    `/api/milestone-nodes/${node.id}/feedback`,
  );
  const { data: attachments, refetch: refetchAttachments } = useApi<Attachment[]>(
    `/api/milestone-nodes/${node.id}/attachments`,
  );

  const [title, setTitle] = useState(node.title);
  const [kind, setKind] = useState<Kind>(node.kind);
  const [assignee, setAssignee] = useState(node.assignee || "");
  const [scoreEdit, setScoreEdit] = useState<number | "">(node.score ?? "");
  const [fbBody, setFbBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPortalNode(document.body);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function saveMeta() {
    const patch: Partial<ApiNode> = {};
    if (title.trim() && title.trim() !== node.title) patch.title = title.trim();
    if (kind !== node.kind) patch.kind = kind;
    if ((assignee.trim() || null) !== (node.assignee || null)) patch.assignee = assignee.trim() || null;
    const scoreVal = scoreEdit === "" ? null : Number(scoreEdit);
    if (scoreVal != null && (isNaN(scoreVal) || scoreVal < 1 || scoreVal > 10)) {
      toast("Score must be 1-10", "error");
      return;
    }
    if (scoreVal !== (node.score ?? null)) patch.score = scoreVal;
    if (Object.keys(patch).length === 0) { onClose(); return; }
    await onUpdate(node.id, patch);
    onClose();
  }

  async function submitFeedback() {
    if (!fbBody.trim()) return;
    try {
      await apiPost(`/api/milestone-nodes/${node.id}/feedback`, {
        author: currentUser?.full_name || "Unknown",
        body: fbBody.trim(),
      });
      setFbBody("");
      await refetchFeedback();
      await onRefetchTree();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const signed = (await apiPost(
        `/api/milestone-nodes/${node.id}/attachments`,
        { filename: file.name, content_type: file.type, size_bytes: file.size },
      )) as { upload_url: string; token: string; attachment_id: string };
      const res = await fetch(signed.upload_url, {
        method: "PUT",
        body: file,
        headers: file.type ? { "Content-Type": file.type } : {},
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      await refetchAttachments();
      await onRefetchTree();
      toast("File uploaded", "success");
    } catch (e) {
      toast(handleApiError(e), "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function download(attId: string) {
    try {
      const { url } = await (await fetch(`/api/milestone-nodes/attachments/${attId}/url`)).json();
      if (!url) throw new Error("Could not generate download link");
      window.open(url, "_blank");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function deleteAttachment(attId: string) {
    if (!confirm("Delete this file? This can't be undone.")) return;
    try {
      await apiDelete(`/api/milestone-nodes/attachments/${attId}`);
      await refetchAttachments();
      await onRefetchTree();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  if (!portalNode) return null;

  const disp = displayStatus(node);
  const c = COLORS[disp];

  const modal = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(3px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        style={{ borderTop: `3px solid ${c.bar}` }}
      >
        <div className="flex items-start justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800 gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <span
              style={{ width: 10, height: 10, borderRadius: 3, background: c.dot, marginTop: 6 }}
              className="flex-shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold flex-shrink-0"
                  style={{ background: c.pill, color: c.pillText }}
                >
                  {node.kind}
                </span>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                  {node.title}
                </span>
              </div>
              <div className="text-[10.5px] text-gray-500 mt-0.5 truncate">
                {path.length > 0 ? path.join(" › ") : "root"}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded flex-shrink-0">
            <HiX className="w-4 h-4" />
          </button>
        </div>

        {/* Edit panel */}
        <div className="p-5 space-y-4">
          {isDoer ? (
            <>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block uppercase tracking-wider">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block uppercase tracking-wider">Kind</label>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as Kind)}
                    className="w-full px-2 py-2 text-sm bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  >
                    {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block uppercase tracking-wider">Owner</label>
                  <input
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    placeholder="Name"
                    className="w-full px-3 py-2 text-sm bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">Score</label>
                    {scoreEdit !== "" && (
                      <button
                        type="button"
                        onClick={() => setScoreEdit("")}
                        className="text-[10px] text-gray-400 hover:text-gray-600 underline-offset-2 hover:underline"
                      >
                        clear
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={scoreEdit === "" ? 5 : scoreEdit}
                      onChange={(e) => setScoreEdit(Number(e.target.value))}
                      className="flex-1 accent-indigo-500"
                    />
                    <span
                      className="w-8 text-right text-base font-semibold"
                      style={{ color: scoreEdit === "" ? "#C7C4BA" : COLORS[scoreColorSafe(Number(scoreEdit)) || "grey"].text }}
                    >
                      {scoreEdit === "" ? "–" : scoreEdit}
                    </span>
                  </div>
                  <div className="flex justify-between text-[9.5px] text-gray-400 mt-1">
                    <span>1-5 red</span>
                    <span>6-8 yellow</span>
                    <span>9-10 green</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-gray-500">
              Kind: <strong>{node.kind}</strong> · Owner: <strong>{node.assignee || "—"}</strong> · Score: <strong>{node.score ?? "—"}</strong>
            </div>
          )}

          {/* Attachments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Attachments ({attachments?.length || 0})
              </p>
              <label className="cursor-pointer text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                <HiOutlinePaperClip className="w-3.5 h-3.5" />
                {uploading ? "Uploading…" : "Upload"}
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                  disabled={uploading}
                />
              </label>
            </div>
            {(attachments || []).length === 0 ? (
              <p className="text-xs text-gray-400 italic">No files attached.</p>
            ) : (
              <ul className="space-y-1">
                {(attachments || []).map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/40 group"
                  >
                    <HiOutlinePaperClip className="w-3 h-3 text-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-700 dark:text-gray-300 truncate">{a.filename}</p>
                      <p className="text-[9px] text-gray-400">
                        {a.uploaded_by} · {formatShort(a.uploaded_at)}
                        {a.size_bytes ? ` · ${humanBytes(a.size_bytes)}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => download(a.id)}
                      title="Download"
                      className="p-1 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <HiOutlineDownload className="w-3.5 h-3.5" />
                    </button>
                    {isDoer && (
                      <button
                        onClick={() => deleteAttachment(a.id)}
                        title="Delete file"
                        className="p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <HiOutlineTrash className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Feedback */}
          <div>
            <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">
              Feedback ({feedback?.length || 0})
            </p>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {(feedback || []).length === 0 && <p className="text-xs text-gray-400 italic">No feedback yet.</p>}
              {(feedback || []).map((f) => (
                <div key={f.id} className="bg-gray-50/70 dark:bg-gray-800/40 rounded-lg p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{f.author}</span>
                    <span className="text-[9px] text-gray-400">{formatShort(f.created_at)}</span>
                  </div>
                  <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{f.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={fbBody}
                onChange={(e) => setFbBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitFeedback(); }}
                placeholder="Add feedback…"
                className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              <button
                onClick={submitFeedback}
                disabled={!fbBody.trim()}
                className="px-3 py-1.5 text-xs bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white rounded-lg transition-all"
              >
                Post
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800">
          {isDoer && node.kind !== "Milestone" ? (
            <button
              onClick={() => onDelete(node.id)}
              className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
            >
              <HiOutlineTrash className="w-3.5 h-3.5" /> Delete node
            </button>
          ) : (
            <span className="text-[10.5px] text-gray-400 italic">
              {node.kind === "Milestone" ? "Root — can't delete" : ""}
            </span>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg">
              Close
            </button>
            {isDoer && (
              <button
                onClick={saveMeta}
                className="px-4 py-1.5 text-xs bg-gradient-to-r from-indigo-500 to-violet-500 text-white rounded-lg shadow-md hover:brightness-110"
              >
                Save
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, portalNode);
}

// ─── Create-child modal (light) ─────────────────────────────────────────────
function CreateNodeModal({
  parentId,
  initialKind,
  onCancel,
  onCreate,
}: {
  parentId: string | null;
  initialKind: Kind;
  onCancel: () => void;
  onCreate: (parentId: string | null, kind: Kind, title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>(initialKind);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalNode(document.body);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (!portalNode) return null;

  const modal = (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(3px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3"
      >
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          {parentId ? "Add child" : "Plant milestone"}
        </h3>
        <div>
          <label className="text-[10px] text-gray-500 mb-1 block uppercase tracking-wider">Kind</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="w-full px-3 py-2 text-sm bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg"
          >
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 mb-1 block uppercase tracking-wider">Title</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) onCreate(parentId, kind, title);
            }}
            placeholder={`New ${kind} title…`}
            className="w-full px-3 py-2 text-sm bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg">
            Cancel
          </button>
          <button
            onClick={() => onCreate(parentId, kind, title)}
            disabled={!title.trim()}
            className="px-4 py-1.5 text-xs bg-gradient-to-r from-indigo-500 to-violet-500 text-white rounded-lg shadow-md hover:brightness-110 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, portalNode);
}

function scoreColorSafe(score: number | null): Status | null {
  if (score == null || isNaN(score)) return null;
  if (score <= 5) return "red";
  if (score <= 8) return "yellow";
  return "green";
}

// ─── Small utils ─────────────────────────────────────────────────────────────
function humanBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatShort(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

