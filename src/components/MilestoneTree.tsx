"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useApi, apiPost, apiPatch, apiDelete, invalidateCache } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { useToast, SkeletonRows } from "@/components/ui";
import { handleApiError } from "@/lib/utils";
import { ownStatus, STATUS_HEX, type Status } from "@/lib/treeStatus";
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
  pending_attachment_count?: number;
};

type TreeNode = ApiNode & {
  children: TreeNode[];
  attachmentCount: number; // alias for treeStatus lib
};

type Feedback = { id: string; author: string; body: string; created_at: string };
type Attachment = {
  id: string;
  kind?: "file" | "link" | "text";
  filename: string;
  link_url?: string | null;
  text_body?: string | null;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  uploaded_at: string;
  reviewed?: boolean;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
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
  // "black" now = attachment present but not yet scored ("highlighted / awaiting review").
  // Kept the key name so treeStatus.ts stays untouched, but the palette is a
  // steel blue that reads as "flagged — needs a score" instead of "final/done".
  black: { bar: "#3B7DD1", dot: "#3B7DD1", text: "#1F4E82", pill: "#E7EFFA", pillText: "#1F4E82" },
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
type Heights = Record<string, number>;

/** Estimate card height from title length. ~16 characters fit per line at
 *  typical fs 13.5 in NODE_W. Base = kind chip + assignee row + padding. */
function estimateCardHeight(title: string): number {
  const CHARS_PER_LINE = 16;
  const lines = Math.max(1, Math.ceil((title || "").length / CHARS_PER_LINE));
  const TITLE_LINE_H = 17;
  const BASE = 34; // kind chip row (16) + assignee row (14) + vertical padding (~4)
  return Math.max(NODE_H, BASE + TITLE_LINE_H * lines);
}

function layout(root: TreeNode): {
  positions: Positions;
  heights: Heights;
  width: number;
  height: number;
  maxDepth: number;
} {
  const positions: Positions = {};
  const heights: Heights = {};

  // Pass 1: compute a display height for every node from its title.
  const walkAll = (n: TreeNode) => {
    heights[n.id] = estimateCardHeight(n.title);
    n.children.forEach(walkAll);
  };
  walkAll(root);

  // Pass 2: find the tallest card at each visible depth so every row stacks
  // cleanly without overlap.
  const depthMaxH: number[] = [];
  const measureDepths = (n: TreeNode, depth: number) => {
    depthMaxH[depth] = Math.max(depthMaxH[depth] || 0, heights[n.id]);
    if (!n.collapsed) n.children.forEach((c) => measureDepths(c, depth + 1));
  };
  measureDepths(root, 0);

  // Pre-compute y-offset per depth: y[d] = 10 + Σ (depthMaxH[i] + V_GAP) for i<d
  const yAt: number[] = [10];
  for (let d = 0; d < depthMaxH.length; d++) {
    yAt[d + 1] = yAt[d] + depthMaxH[d] + V_GAP;
  }

  let cursorX = 0;
  let maxDepth = 0;
  const place = (node: TreeNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const visibleKids = node.collapsed ? [] : node.children;
    if (!visibleKids.length) {
      const x = cursorX;
      cursorX += NODE_W + H_GAP;
      positions[node.id] = { x, y: yAt[depth], depth };
      return x + NODE_W / 2;
    }
    const centers = visibleKids.map((c) => place(c, depth + 1));
    const mid = (centers[0] + centers[centers.length - 1]) / 2;
    positions[node.id] = { x: mid - NODE_W / 2, y: yAt[depth], depth };
    return mid;
  };
  place(root, 0);

  let maxX = 0;
  let maxY = 0;
  for (const [id, p] of Object.entries(positions)) {
    maxX = Math.max(maxX, p.x + NODE_W);
    maxY = Math.max(maxY, p.y + heights[id]);
  }
  return { positions, heights, width: maxX, height: maxY + TRUNK, maxDepth };
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

/** Total pending-review submissions in this node + all descendants. Used to
 *  drive the "N pending" badge on cards so a collapsed branch surfaces what
 *  still needs a look. */
function subtreePendingCount(node: TreeNode): number {
  let sum = node.pending_attachment_count || 0;
  for (const c of node.children) sum += subtreePendingCount(c);
  return sum;
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
              <button type="button"
                onClick={() => setCreateUnder({ parentId: null, kind: "Milestone" })}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm rounded-xl shadow-md hover:brightness-110 transition-all"
              >
                + Create first Milestone
              </button>
              <button type="button"
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
          <button type="button"
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
  const { positions, heights, width, height } = useMemo(() => layout(root), [root]);
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
        <button type="button"
          onClick={() => setZoomMode("fit")}
          className={`px-2 py-0.5 rounded-md border ${
            zoomMode === "fit"
              ? "bg-indigo-500 text-white border-indigo-500"
              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
          }`}
        >
          Fit
        </button>
        <button type="button"
          onClick={() => setZoomMode("actual")}
          className={`px-2 py-0.5 rounded-md border ${
            zoomMode === "actual"
              ? "bg-indigo-500 text-white border-indigo-500"
              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
          }`}
        >
          100%
        </button>
        <button type="button"
          onClick={() => setZoomMode(Math.max(0.25, scale - 0.1))}
          className="px-1.5 py-0.5 rounded-md border bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
        >
          −
        </button>
        <span className="w-10 text-center text-gray-500 tabular-nums">{zoomPct}%</span>
        <button type="button"
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
            // Branches: THICK at the trunk (depth 0), sharply tapering toward
            // the leaves. Starts at ~24 and thins to ~3 by depth 5.
            const widthAt = (depth: number) => Math.max(3, 24 - depth * 4.5);
            const rootP = positions[root.id];

            // Central trunk: descends from the milestone tip to the base of
            // the canvas, thickening as it goes.
            if (rootP) {
              const cx = rootP.x + NODE_W / 2;
              const topY = rootP.y + (heights[root.id] || NODE_H) / 2;
              const baseY = height + PAD - 18;
              const topH = widthAt(0) / 2;
              const baseH = 22;
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
                const y1 = p.y + (heights[n.id] || NODE_H);
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
              const by = p.y + (heights[n.id] || NODE_H) + 6;
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
            cardHeight={heights[n.id] || NODE_H}
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

// ─── Node card ──────────────────────────────────────────────────────────────
// Color reflects OWN status only (no worst-child rollup) — so grey means "not
// touched yet", steel-blue "black" means "attachment added, awaiting score",
// and red/yellow/green come from the score itself. This is what makes the
// tree eyeball-able for progress: count non-grey nodes.
function NodeCard({
  node,
  pos,
  cardHeight,
  hasKids,
  onOpen,
  onToggle,
  onAdd,
}: {
  node: TreeNode;
  pos: { x: number; y: number; depth: number };
  cardHeight: number;
  hasKids: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (parentId: string) => void;
}) {
  const own = ownStatus(node);
  const c = COLORS[own];
  const assignee = node.assignee || node.owner?.full_name || null;
  const hasAtt = node.attachment_count > 0;
  const isMilestone = node.kind === "Milestone";
  const isGoal = node.kind === "Goal";
  const isTask = node.kind === "Task";

  // Kind-driven typography — Milestone reads as the anchor, Task the leaf.
  const titleSize = isMilestone ? 14 : isGoal ? 13.5 : isTask ? 12.5 : 13;
  const titleWeight = isMilestone ? 700 : isGoal ? 600 : 500;

  // Aggregate progress badge on the Milestone card — how many descendants
  // have some sign of progress (attachment or score). Lets you eyeball
  // completion without expanding every branch.
  let progressText: string | null = null;
  if (isMilestone) {
    const all: TreeNode[] = [];
    const walk = (x: TreeNode) => { x.children.forEach((c) => { all.push(c); walk(c); }); };
    walk(node);
    const touched = all.filter((x) => x.score != null || x.attachment_count > 0).length;
    progressText = `${touched}/${all.length}`;
  }

  // Pending-submission highlight — TWO distinct treatments:
  //   1. Direct pending (this card has unreviewed items) → SOLID amber wash,
  //      thick ring, prominent pill. "Open this one to review."
  //   2. Rollup pending (only descendants are pending) → SUBTLE tint + dashed
  //      amber outline, ghost pill. "Expand and drill in."
  // Eye is drawn to the solid amber cards first; the dashed ones just tell
  // you where to expand.
  const pendingRollup = subtreePendingCount(node);
  const hasPendingHere = (node.pending_attachment_count || 0) > 0;
  const rollupOnly = !hasPendingHere && pendingRollup > 0;

  const cardBg = hasPendingHere
    ? "#FFF4C5" // solid amber wash
    : rollupOnly
      ? "#FDFBF0" // barely-there tint
      : isMilestone
        ? "#FFFEF9"
        : "#FFFFFF";
  const borderColor = hasPendingHere
    ? "#E9A100"
    : rollupOnly
      ? "#D6B84A"
      : "#E4E1D8";
  const borderWidth = hasPendingHere ? 2 : rollupOnly ? 1.5 : 0.5;
  const borderStyle = rollupOnly ? "dashed" : "solid";
  const topBar = hasPendingHere ? "#E9A100" : c.bar;
  const topBarWidth = hasPendingHere ? 5 : 3;
  const shadow = hasPendingHere
    ? "0 3px 10px rgba(233,161,0,0.32)"
    : isMilestone
      ? "0 2px 6px rgba(0,0,0,0.06)"
      : "0 1px 2px rgba(0,0,0,0.03)";

  return (
    <div
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: NODE_W,
        height: cardHeight,
        background: cardBg,
        borderRadius: 12,
        border: `${borderWidth}px ${borderStyle} ${borderColor}`,
        borderTop: `${topBarWidth}px solid ${topBar}`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        gap: 3,
        padding: "6px 10px",
        cursor: "pointer",
        boxShadow: shadow,
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
        {/* Pending-review rollup — this node + everything under it.
            Direct pending (this card): solid loud pill.
            Rollup only (children): ghost outline pill telling you where to look. */}
        {pendingRollup > 0 && hasPendingHere && (
          <span
            title={`${node.pending_attachment_count} pending on this card, ${pendingRollup} total in subtree`}
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              padding: "2px 8px",
              borderRadius: 10,
              background: "#E9A100",
              color: "#FFFFFF",
              boxShadow: "0 1px 3px rgba(233,161,0,0.4)",
              marginLeft: "auto",
              flexShrink: 0,
              letterSpacing: 0.3,
            }}
          >
            {node.pending_attachment_count} REVIEW
          </span>
        )}
        {pendingRollup > 0 && !hasPendingHere && (
          <span
            title={
              node.collapsed
                ? `${pendingRollup} pending review inside this branch — click "+N" to expand`
                : `${pendingRollup} pending review below this card`
            }
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 8,
              background: "transparent",
              color: "#A87700",
              border: "1px dashed #D6B84A",
              marginLeft: "auto",
              flexShrink: 0,
            }}
          >
            {pendingRollup} below
          </span>
        )}
        {progressText && !subtreePendingCount(node) && (
          <span
            title="descendants with attachment or score"
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 8,
              background: "#EEF2FA",
              color: "#1F4E82",
              marginLeft: "auto",
              flexShrink: 0,
            }}
          >
            {progressText}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: titleSize,
          fontWeight: titleWeight,
          color: "#2C2C2A",
          lineHeight: 1.28,
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          whiteSpace: "normal",
        }}
      >
        {node.title}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: "auto",
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
      {hasKids && (
        <button type="button"
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
      <button type="button"
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
  const [addMode, setAddMode] = useState<"none" | "link" | "text">("none");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [textLabel, setTextLabel] = useState("");
  const [textBody, setTextBody] = useState("");
  const [expandedText, setExpandedText] = useState<Set<string>>(new Set());
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

  async function submitLink() {
    if (!linkLabel.trim() || !linkUrl.trim()) { toast("Label and URL required", "error"); return; }
    try {
      await apiPost(`/api/milestone-nodes/${node.id}/attachments`, {
        kind: "link",
        filename: linkLabel.trim(),
        link_url: linkUrl.trim(),
      });
      setLinkLabel(""); setLinkUrl(""); setAddMode("none");
      await refetchAttachments();
      await onRefetchTree();
      toast("Link added", "success");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function submitText() {
    if (!textLabel.trim() || !textBody.trim()) { toast("Label and note body required", "error"); return; }
    try {
      await apiPost(`/api/milestone-nodes/${node.id}/attachments`, {
        kind: "text",
        filename: textLabel.trim(),
        text_body: textBody.trim(),
      });
      setTextLabel(""); setTextBody(""); setAddMode("none");
      await refetchAttachments();
      await onRefetchTree();
      toast("Note added", "success");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function toggleReviewed(attId: string, next: boolean) {
    try {
      await apiPatch(`/api/milestone-nodes/attachments/${attId}`, { reviewed: next });
      await refetchAttachments();
      await onRefetchTree();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function download(attId: string) {
    try {
      const { url } = await (await fetch(`/api/milestone-nodes/attachments/${attId}/url`)).json();
      if (!url) throw new Error("Could not generate download link");
      window.open(url, "_blank");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function deleteAttachment(attId: string) {
    if (!confirm("Delete this submission? This can't be undone.")) return;
    try {
      await apiDelete(`/api/milestone-nodes/attachments/${attId}`);
      await refetchAttachments();
      await onRefetchTree();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  if (!portalNode) return null;

  // Match the tree card: own-status colour, no rollup.
  const disp = ownStatus(node);
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
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded flex-shrink-0">
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

          {/* Submissions — files, links, and notes. New items land with
              reviewed=false and get highlighted amber until someone marks
              them reviewed. */}
          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Submissions ({attachments?.length || 0})
                {(attachments || []).some((a) => a.reviewed !== true) && (
                  <span className="ml-2 text-[9.5px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-1.5 py-0.5">
                    {(attachments || []).filter((a) => a.reviewed !== true).length} pending
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2 text-xs">
                <label className="cursor-pointer text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                  <HiOutlinePaperClip className="w-3.5 h-3.5" />
                  {uploading ? "Uploading…" : "File"}
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
                <button
                  type="button"
                  onClick={() => setAddMode(addMode === "link" ? "none" : "link")}
                  className="text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  🔗 Link
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode(addMode === "text" ? "none" : "text")}
                  className="text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  📝 Note
                </button>
              </div>
            </div>

            {addMode === "link" && (
              <div className="mb-2 p-2.5 bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-200/60 dark:border-indigo-800/30 rounded-lg space-y-2">
                <input
                  autoFocus
                  value={linkLabel}
                  onChange={(e) => setLinkLabel(e.target.value)}
                  placeholder="Label (e.g. Figma spec, Q3 doc)"
                  className="w-full px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                />
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitLink(); }}
                  placeholder="https://..."
                  className="w-full px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setAddMode("none")} className="px-2 py-0.5 text-[11px] text-gray-500 hover:text-gray-700">Cancel</button>
                  <button type="button" onClick={submitLink} className="px-3 py-0.5 text-[11px] bg-indigo-500 hover:bg-indigo-600 text-white rounded">Add link</button>
                </div>
              </div>
            )}

            {addMode === "text" && (
              <div className="mb-2 p-2.5 bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-200/60 dark:border-indigo-800/30 rounded-lg space-y-2">
                <input
                  autoFocus
                  value={textLabel}
                  onChange={(e) => setTextLabel(e.target.value)}
                  placeholder="Label (e.g. Status update, Blocker note)"
                  className="w-full px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                />
                <textarea
                  value={textBody}
                  onChange={(e) => setTextBody(e.target.value)}
                  placeholder="Note body…"
                  rows={4}
                  className="w-full px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded resize-vertical"
                />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setAddMode("none")} className="px-2 py-0.5 text-[11px] text-gray-500 hover:text-gray-700">Cancel</button>
                  <button type="button" onClick={submitText} className="px-3 py-0.5 text-[11px] bg-indigo-500 hover:bg-indigo-600 text-white rounded">Add note</button>
                </div>
              </div>
            )}

            {(attachments || []).length === 0 && addMode === "none" ? (
              <p className="text-xs text-gray-400 italic">No submissions yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {(attachments || []).map((a) => {
                  const isPending = a.reviewed !== true;
                  const isLink = a.kind === "link";
                  const isText = a.kind === "text";
                  const isFile = !isLink && !isText;
                  const bg = isPending
                    ? "bg-amber-50/70 dark:bg-amber-900/10 border-l-2 border-amber-400"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/40";
                  return (
                    <li
                      key={a.id}
                      className={`py-1.5 px-2 rounded-md group ${bg}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm flex-shrink-0" title={a.kind || "file"}>
                          {isLink ? "🔗" : isText ? "📝" : "📎"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-xs text-gray-700 dark:text-gray-300 truncate font-medium">{a.filename}</p>
                            {isPending && (
                              <span className="text-[8.5px] font-bold text-amber-700 bg-amber-200 rounded px-1 py-0.5 flex-shrink-0">
                                NEW
                              </span>
                            )}
                          </div>
                          <p className="text-[9px] text-gray-400 truncate">
                            {a.uploaded_by} · {formatShort(a.uploaded_at)}
                            {a.size_bytes ? ` · ${humanBytes(a.size_bytes)}` : ""}
                          </p>
                        </div>
                        {isFile && (
                          <button
                            type="button"
                            onClick={() => download(a.id)}
                            title="Download"
                            className="p-1 text-gray-400 hover:text-blue-600 flex-shrink-0"
                          >
                            <HiOutlineDownload className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isLink && a.link_url && (
                          <a
                            href={a.link_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open link"
                            className="p-1 text-blue-500 hover:text-blue-700 text-xs flex-shrink-0"
                          >
                            ↗
                          </a>
                        )}
                        {isText && a.text_body && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedText((prev) => {
                                const n = new Set(prev);
                                if (n.has(a.id)) n.delete(a.id); else n.add(a.id);
                                return n;
                              })
                            }
                            title={expandedText.has(a.id) ? "Collapse" : "Expand"}
                            className="p-1 text-gray-400 hover:text-gray-700 text-xs flex-shrink-0"
                          >
                            {expandedText.has(a.id) ? "−" : "+"}
                          </button>
                        )}
                        {isPending && (
                          <button
                            type="button"
                            onClick={() => toggleReviewed(a.id, true)}
                            title="Mark reviewed"
                            className="px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded flex-shrink-0"
                          >
                            ✓ Reviewed
                          </button>
                        )}
                        {!isPending && (
                          <button
                            type="button"
                            onClick={() => toggleReviewed(a.id, false)}
                            title="Un-mark reviewed"
                            className="text-[9px] text-gray-400 hover:text-gray-600 flex-shrink-0"
                          >
                            un-review
                          </button>
                        )}
                        {isDoer && (
                          <button
                            type="button"
                            onClick={() => deleteAttachment(a.id)}
                            title="Delete"
                            className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0"
                          >
                            <HiOutlineTrash className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {isText && expandedText.has(a.id) && a.text_body && (
                        <div className="mt-1.5 ml-6 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap bg-white dark:bg-gray-900 rounded p-2 border border-gray-100 dark:border-gray-800">
                          {a.text_body}
                        </div>
                      )}
                    </li>
                  );
                })}
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
              <button type="button"
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
            <button type="button"
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
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg">
              Close
            </button>
            {isDoer && (
              <button type="button"
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
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg">
            Cancel
          </button>
          <button type="button"
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

