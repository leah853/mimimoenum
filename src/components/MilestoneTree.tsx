"use client";

import { useMemo, useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { useApi, apiPost, apiPatch, apiDelete, invalidateCache } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { useToast, SkeletonRows } from "@/components/ui";
import { handleApiError } from "@/lib/utils";
import { ownStatus, displayStatus, STATUS_HEX, type Status } from "@/lib/treeStatus";
import {
  HiX,
  HiOutlinePaperClip,
  HiOutlineDownload,
  HiOutlineTrash,
} from "react-icons/hi";
import MilestoneDashboard from "@/components/MilestoneDashboard";

// ─── Types ───────────────────────────────────────────────────────────────────
export type Kind = "Milestone" | "Goal" | "Sub-goal" | "Task" | "Sub-task";

export type ApiNode = {
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

export type TreeNode = ApiNode & {
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

// ─── Per-depth card + spacing constants (family-tree) ──────────────────────
// The layout is a Reingold-Tilford-style subtree-width algorithm: each parent
// centers its children horizontally directly below it, and total width is the
// sum of subtree widths. Cards shrink at each depth to keep the tree bounded.
const CARD_W = [220, 180, 140, 130, 100] as const;
const CARD_H = [70, 60, 56, 60, 32] as const;
// V_GAP[d] = vertical gap between a parent at depth (d-1) and children at depth d.
const V_GAP_D = [0, 42, 36, 28, 22, 18] as const;
// H_GAP[d] = horizontal gap between siblings at depth d.
const H_GAP_D = [0, 20, 20, 14, 10, 8] as const;
const MAX_DEPTH = 4;
const PAD_H = 60;
const PAD_V = 40;
// Row-wrap thresholds by CHILD depth. When a parent has more than MAX_PER_ROW_D
// children of the same kind AND all children are leaves, arrange them in a
// grid of rows below the parent instead of one wide horizontal strip.
const MAX_PER_ROW_D = [0, 0, 4, 5, 6] as const;
const INTRA_ROW_GAP = 10;

const depthOfKind = (k: Kind): number =>
  k === "Milestone" ? 0 : k === "Goal" ? 1 : k === "Sub-goal" ? 2 : k === "Task" ? 3 : 4;

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

const KINDS: Kind[] = ["Milestone", "Goal", "Sub-goal", "Task", "Sub-task"];

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

// ─── Layout: family tree (Reingold-Tilford subtree-width) ───────────────────
// For every node we compute subtreeWidth bottom-up (= max of own card width
// vs. sum of children widths + inter-sibling gaps). Then we place top-down,
// centering each parent above the horizontal band its children occupy. This
// yields a classic top-down family tree where children fan out horizontally
// directly under their parent at every depth.
type Positions = Record<string, { x: number; y: number; depth: number }>;

function layout(root: TreeNode): {
  positions: Positions;
  width: number;
  height: number;
  visibleLeaves: { id: string; x: number; yBottom: number; depth: number }[];
  maxDepth: number;
} {
  const positions: Positions = {};
  const subtreeW = new Map<string, number>();
  const visibleLeaves: { id: string; x: number; yBottom: number; depth: number }[] = [];
  // rowInfo[nodeId] = null (classic spread) or grid metadata (row-wrap layout).
  const rowInfo = new Map<
    string,
    { perRow: number; rows: number; childD: number } | null
  >();

  const computeWidth = (n: TreeNode, depth: number): number => {
    const d = Math.min(depth, MAX_DEPTH);
    const cw = CARD_W[d];
    if (n.children.length === 0) {
      subtreeW.set(n.id, cw);
      rowInfo.set(n.id, null);
      return cw;
    }
    const childD = Math.min(depth + 1, MAX_DEPTH);
    const N = n.children.length;
    const maxPerRow = MAX_PER_ROW_D[childD] || 0;
    const kind0 = n.children[0].kind;
    const allSameKind = n.children.every((c) => c.kind === kind0);
    const allLeaves = n.children.every((c) => c.children.length === 0);
    const canWrap = maxPerRow > 0 && N > maxPerRow && allSameKind && allLeaves;

    if (canWrap) {
      // Leaves: computeWidth just sets subtreeW = card width; still walk them.
      n.children.forEach((c) => computeWidth(c, childD));
      const perRow = maxPerRow;
      const rows = Math.ceil(N / perRow);
      const rowWidth = perRow * CARD_W[childD] + (perRow - 1) * H_GAP_D[childD];
      rowInfo.set(n.id, { perRow, rows, childD });
      const w = Math.max(cw, rowWidth);
      subtreeW.set(n.id, w);
      return w;
    }

    rowInfo.set(n.id, null);
    let sum = 0;
    n.children.forEach((c, i) => {
      sum += computeWidth(c, childD);
      if (i > 0) sum += H_GAP_D[childD];
    });
    const w = Math.max(cw, sum);
    subtreeW.set(n.id, w);
    return w;
  };
  computeWidth(root, 0);

  const place = (n: TreeNode, xCenter: number, yTop: number, depth: number) => {
    const d = Math.min(depth, MAX_DEPTH);
    const cw = CARD_W[d];
    const ch = CARD_H[d];
    positions[n.id] = { x: xCenter - cw / 2, y: yTop, depth: d };
    if (n.children.length === 0) {
      visibleLeaves.push({ id: n.id, x: xCenter, yBottom: yTop + ch, depth: d });
      return;
    }
    const childD = Math.min(depth + 1, MAX_DEPTH);
    const childY = yTop + ch + V_GAP_D[childD];
    const info = rowInfo.get(n.id);

    if (info) {
      const { perRow, rows, childD: cd } = info;
      const N = n.children.length;
      const childCW = CARD_W[cd];
      const childCH = CARD_H[cd];
      const gap = H_GAP_D[cd];
      n.children.forEach((c, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const inRow = row === rows - 1 ? N - row * perRow : perRow;
        const thisRowWidth = inRow * childCW + (inRow - 1) * gap;
        const rowStart = xCenter - thisRowWidth / 2;
        const cx = rowStart + col * (childCW + gap) + childCW / 2;
        const cy = childY + row * (childCH + INTRA_ROW_GAP);
        place(c, cx, cy, cd);
      });
      return;
    }

    let total = 0;
    n.children.forEach((c, i) => {
      total += subtreeW.get(c.id) || CARD_W[childD];
      if (i > 0) total += H_GAP_D[childD];
    });
    let cursorX = xCenter - total / 2;
    for (const c of n.children) {
      const cw2 = subtreeW.get(c.id) || CARD_W[childD];
      place(c, cursorX + cw2 / 2, childY, childD);
      cursorX += cw2 + H_GAP_D[childD];
    }
  };

  const rootW = subtreeW.get(root.id) || CARD_W[0];
  // Canvas width = subtree width + horizontal padding on both sides. Place the
  // Milestone at the exact horizontal center of that canvas so its card sits
  // directly above the centered Goals row.
  const canvasWidth = rootW + PAD_H * 2;
  place(root, canvasWidth / 2, PAD_V, 0);

  // Canvas bounds
  let maxX = 0;
  let maxY = 0;
  for (const p of Object.values(positions)) {
    const cw = CARD_W[p.depth];
    const ch = CARD_H[p.depth];
    if (p.x + cw > maxX) maxX = p.x + cw;
    if (p.y + ch > maxY) maxY = p.y + ch;
  }
  return {
    positions,
    width: maxX + PAD_H,
    height: maxY + PAD_V + 60, // room for leaf clusters at bottom
    visibleLeaves,
    maxDepth: MAX_DEPTH,
  };
}

function flatten(node: TreeNode, acc: TreeNode[]): TreeNode[] {
  acc.push(node);
  if (!node.collapsed) node.children.forEach((c) => flatten(c, acc));
  return acc;
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
export type MilestoneTreeHandle = {
  expandAll: () => void;
  collapseAll: () => void;
  resetView: () => void;
};

const EXPAND_KEY = "mimimoenum:pine-expanded";

/** Prune the tree to only include: root Milestone + its direct Goal children +
 *  any descendants of nodes in the expanded set. Returned nodes have
 *  `collapsed=false` so the layout treats them uniformly. */
function pruneForPine(root: TreeNode, expanded: Set<string>): TreeNode {
  const walk = (n: TreeNode): TreeNode => {
    // Root Milestone always shows its direct Goal children; deeper nodes
    // require explicit expansion.
    const showChildren = n.kind === "Milestone" || expanded.has(n.id);
    const children = showChildren ? n.children.map(walk) : [];
    return { ...n, children, collapsed: false };
  };
  return walk(root);
}

/** Collect IDs of every non-Milestone node in the ORIGINAL tree that has at
 *  least one child. Used for "Expand all" and to decide which cards show a
 *  chevron. */
function collectExpandableIds(root: TreeNode, out: Set<string>) {
  if (root.children.length > 0 && root.kind !== "Milestone") out.add(root.id);
  root.children.forEach((c) => collectExpandableIds(c, out));
}

const MilestoneTree = forwardRef<MilestoneTreeHandle, { viewMode?: "pine" | "dashboard" }>(function MilestoneTree(
  { viewMode = "pine" },
  ref,
) {
  const { data: apiNodes, loading, refetch } = useApi<ApiNode[]>("/api/milestone-nodes");
  const { dbUser, appRole } = useAuth();
  const { toast } = useToast();
  const isDoer = appRole === "doer" || appRole === "admin";

  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const [createUnder, setCreateUnder] = useState<{ parentId: string | null; kind: Kind } | null>(null);

  // Per-node UI expansion for the pine view. Persisted to localStorage.
  // Default = empty set → only Milestone + Goals visible.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(EXPAND_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setExpanded(new Set(arr as string[]));
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(EXPAND_KEY, JSON.stringify([...expanded]));
    } catch {}
  }, [expanded]);
  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const roots = useMemo(() => buildRoots(apiNodes || []), [apiNodes]);

  // Every non-Milestone node in the ORIGINAL tree that has children — the
  // universe of "chevronable" ids and the set applied by Expand-all.
  const expandableIds = useMemo(() => {
    const s = new Set<string>();
    roots.forEach((r) => collectExpandableIds(r, s));
    return s;
  }, [roots]);

  useImperativeHandle(
    ref,
    () => ({
      expandAll: () => setExpanded(new Set(expandableIds)),
      collapseAll: () => setExpanded(new Set()),
      resetView: () => {
        try { localStorage.removeItem(EXPAND_KEY); } catch {}
        setExpanded(new Set());
      },
    }),
    [expandableIds],
  );

  // Prune any stale IDs from the expanded set once the tree is loaded — nodes
  // that no longer exist (deleted, migrated) should not linger and inflate the
  // localStorage set.
  useEffect(() => {
    if (!apiNodes) return;
    setExpanded((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set<string>();
      for (const n of apiNodes) alive.add(n.id);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (alive.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [apiNodes]);

  // Pruned roots — what actually gets laid out.
  const prunedRoots = useMemo(
    () => roots.map((r) => pruneForPine(r, expanded)),
    [roots, expanded],
  );
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
      ) : viewMode === "dashboard" ? (
        <MilestoneDashboard
          roots={roots}
          onOpenNode={setOpenNodeId}
          onAddGoal={(milestoneId) => setCreateUnder({ parentId: milestoneId, kind: "Goal" })}
        />
      ) : (
        prunedRoots.map((root) => (
          <PineCanvas
            key={root.id}
            root={root}
            expandableIds={expandableIds}
            expanded={expanded}
            onOpen={setOpenNodeId}
            onToggle={toggleExpanded}
            onAdd={(parentId) => {
              const originalRoot = roots.find((r) => r.id === root.id) || root;
              const kind = defaultChildKind(originalRoot, parentId);
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
});

MilestoneTree.displayName = "MilestoneTree";
export default MilestoneTree;

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
  if (parent.kind === "Sub-goal") return "Task";
  return "Sub-task";
}

// ─── The pine canvas: ambient backdrop + trunk/limbs/leaves + node cards ────
// Wraps the raw pine in an auto-fit-to-width scaler so 60+ node trees don't
// spill off the viewport. Users can override with the zoom controls.
type ZoomMode = "fit" | "actual" | number;

function PineCanvas({
  root,
  expandableIds,
  expanded,
  onOpen,
  onToggle,
  onAdd,
}: {
  root: TreeNode;
  expandableIds: Set<string>;
  expanded: Set<string>;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (parentId: string) => void;
}) {
  const { positions, width, height, visibleLeaves } = useMemo(() => layout(root), [root]);
  const nodes = useMemo(() => flatten(root, []), [root]);
  const PAD = 20;

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
  // Fit-zoom: fit both dimensions inside viewport, capped at 1.5× so a small
  // tree scales up nicely instead of sitting as a tiny island. Floor at 0.35×
  // so a huge tree still fits without being unreadable — user can zoom in.
  const fitScale = (() => {
    if (containerW <= 0) return 1;
    const viewportH = typeof window !== "undefined" ? window.innerHeight - 220 : 800;
    const byW = containerW / canvasW;
    const byH = viewportH / canvasH;
    return Math.max(0.4, Math.min(1.4, Math.min(byW, byH)));
  })();
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
            // Branch trunk widths by parent depth (thicker near root).
            const trunkTopByDepth = [16, 12, 8, 6, 4];
            const trunkBotByDepth = [10, 8, 6, 4, 3];
            const opByDepth = [1, 1, 0.85, 0.7, 0.6];
            const rootP = positions[root.id];

            // Short thick trunk from Milestone bottom down to the junction ~30px
            // below where the branches fan out to the Goals.
            if (rootP && root.children.length > 0) {
              const cx = rootP.x + CARD_W[0] / 2;
              const topY = rootP.y + CARD_H[0];
              const firstGoal = root.children[0];
              const goalTopY = positions[firstGoal.id]?.y ?? topY;
              const trunkBottomY = topY + Math.min(30, Math.max(6, (goalTopY - topY) * 0.4));
              const topH = 10;
              const botH = 14;
              limbs.push(
                <path
                  key="trunk"
                  d={`M${cx - topH},${topY} L${cx - botH},${trunkBottomY} Q${cx},${trunkBottomY + 5} ${cx + botH},${trunkBottomY} L${cx + topH},${topY} Z`}
                  fill={BARK_D}
                />,
              );
            }

            // Tapered filled bezier branch from every parent's bottom-center
            // to every child's top-center, at every depth.
            const drawBranch = (parent: TreeNode, child: TreeNode, depth: number) => {
              const pp = positions[parent.id];
              const cp = positions[child.id];
              if (!pp || !cp) return;
              const parentCx = pp.x + CARD_W[depth] / 2;
              const parentBot = pp.y + CARD_H[depth];
              const childCx = cp.x + CARD_W[depth + 1] / 2;
              const childTop = cp.y;
              const wTop = trunkTopByDepth[depth];
              const wBot = trunkBotByDepth[depth];
              const hTop = wTop / 2;
              const hBot = wBot / 2;
              const my = (parentBot + childTop) / 2;
              const d =
                `M${parentCx - hTop},${parentBot} ` +
                `C${parentCx - hTop},${my} ${childCx - hBot},${my} ${childCx - hBot},${childTop} ` +
                `L${childCx + hBot},${childTop} ` +
                `C${childCx + hBot},${my} ${parentCx + hTop},${my} ${parentCx + hTop},${parentBot} Z`;
              limbs.push(
                <path
                  key={`br${depth}-${parent.id}-${child.id}`}
                  d={d}
                  fill={BARK}
                  opacity={opByDepth[depth]}
                />,
              );
              // Fillet at the parent bottom to hide the taper corner.
              limbs.push(
                <circle
                  key={`jn${depth}-${parent.id}-${child.id}`}
                  cx={parentCx}
                  cy={parentBot}
                  r={hTop}
                  fill={BARK}
                  opacity={opByDepth[depth]}
                />,
              );
            };

            const walkBranches = (n: TreeNode, depth: number) => {
              if (depth >= MAX_DEPTH) return;
              for (const c of n.children) {
                drawBranch(n, c, depth);
                walkBranches(c, depth + 1);
              }
            };
            walkBranches(root, 0);

            // One 4-ellipse cluster at the bottom tip of every VISIBLE LEAF
            // — every card that isn't currently showing children.
            visibleLeaves.forEach((lf) => {
              const bx = lf.x;
              const by = lf.yBottom + 10;
              const leaf = (
                dx: number,
                dy: number,
                r: number,
                rot: number,
                fill: string,
                op: number,
              ) => (
                <ellipse
                  key={`lf${lf.id}${dx}${dy}`}
                  cx={bx + dx}
                  cy={by + dy}
                  rx={r}
                  ry={r * 0.62}
                  fill={fill}
                  opacity={op}
                  transform={`rotate(${rot} ${bx + dx} ${by + dy})`}
                />
              );
              limbs.push(leaf(-14, 3, 11, -28, "#8FB98C", 0.9));
              limbs.push(leaf(0, 8, 13, 8, "#7FAE7C", 0.9));
              limbs.push(leaf(14, 3, 11, 30, "#9CC499", 0.9));
              limbs.push(leaf(0, 14, 10, 0, "#88B585", 0.85));
            });

            return limbs;
          })()}
        </svg>

        {nodes.map((n) => {
          const pos = positions[n.id];
          if (!pos) return null;
          return (
            <NodeCard
              key={n.id}
              node={n}
              pos={pos}
              hasKids={expandableIds.has(n.id)}
              isExpanded={expanded.has(n.id)}
              onOpen={onOpen}
              onToggle={onToggle}
              onAdd={onAdd}
            />
          );
        })}
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
  hasKids,
  isExpanded,
  onOpen,
  onToggle,
  onAdd,
}: {
  node: TreeNode;
  pos: { x: number; y: number; depth: number };
  hasKids: boolean;
  isExpanded: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (parentId: string) => void;
}) {
  const disp = displayStatus(node);
  const rollupBar = STATUS_HEX[disp]; // top stripe = worst-child rollup (matches outline)
  const assignee = node.assignee || node.owner?.full_name || null;
  const isMilestone = node.kind === "Milestone";
  const isGoal = node.kind === "Goal";
  const isSub = node.kind === "Sub-goal";
  const isTask = node.kind === "Task";
  const isSubtask = node.kind === "Sub-task";

  // Sub-tasks render as compact leaf chips — no status stripe, no chevron
  // (they cannot have children), and the "+ add child" affordance is hidden.
  if (isSubtask) {
    const own = ownStatus(node);
    const dot = STATUS_HEX[own];
    const stateMark =
      own === "green" ? "✓" : own === "grey" ? "–" : own === "black" ? "●" : "WIP";
    const stateColor = own === "green" ? "#3B6D11" : own === "grey" ? "#9A988E" : STATUS_HEX[own];
    return (
      <div
        style={{
          position: "absolute",
          left: pos.x,
          top: pos.y,
          width: CARD_W[pos.depth],
          height: CARD_H[pos.depth],
          background: "#FFFFFF",
          borderRadius: 999,
          border: "0.5px solid #B4B2A9",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "0 8px",
          cursor: "pointer",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          overflow: "hidden",
        }}
        onClick={() => onOpen(node.id)}
        title={node.title}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dot,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "#2C2C2A",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
            minWidth: 0,
          }}
        >
          {node.title}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: stateColor,
            flexShrink: 0,
          }}
        >
          {stateMark}
        </span>
      </div>
    );
  }

  // Kind-driven card size + typography (family tree — cards shrink at depth).
  const cardW = CARD_W[pos.depth];
  const cardHeight = CARD_H[pos.depth];
  const titleSize = isMilestone ? 14 : isGoal ? 12 : 11;
  const titleWeight = isMilestone ? 700 : isGoal ? 600 : isSub ? 600 : 500;
  const stripeH = isMilestone ? 5 : isGoal ? 4 : 3;
  const kindLabel = node.kind === "Sub-goal" ? "SUB" : node.kind === "Milestone" ? "MILESTONE" : node.kind.toUpperCase();

  // Rollup helpers mirror MilestoneOutline. Progress = touched/total across
  // all descendants; used on milestones and goals with children.
  let touched = 0;
  let total = 0;
  if (node.children.length) {
    const all: TreeNode[] = [];
    const walk = (x: TreeNode) => { x.children.forEach((c) => { all.push(c); walk(c); }); };
    walk(node);
    total = all.length;
    touched = all.filter((x) => x.score != null || x.attachment_count > 0).length;
  }
  const progressText = total > 0 ? `${touched}/${total}` : null;

  // Direct pending-review kids → the "N NEW" solid amber pill.
  const directPendingKids = node.children.reduce(
    (acc, k) => acc + ((k.pending_attachment_count || 0) > 0 ? 1 : 0),
    0,
  );

  // Pending-submission highlight — TWO distinct treatments:
  //   1. Direct pending (this card has unreviewed items) → SOLID amber wash,
  //      thick ring, prominent pill. "Open this one to review."
  //   2. Rollup pending (only descendants are pending) → SUBTLE tint + dashed
  //      amber outline, ghost pill. "Expand and drill in."
  // Eye is drawn to the solid amber cards first; the dashed ones just tell
  // you where to expand.
  const pendingRollup = subtreePendingCount(node);
  const hasPendingHere = (node.pending_attachment_count || 0) > 0;

  const cardBg = hasPendingHere
    ? "#FFF4C5" // solid amber wash — this card has direct pending review
    : isMilestone
      ? "#FFFEF9"
      : "#FFFFFF";
  const borderColor = hasPendingHere ? "#E9A100" : "#B4B2A9";
  const borderWidth = hasPendingHere ? 1.5 : 0.5;
  const shadow = hasPendingHere
    ? "0 3px 10px rgba(233,161,0,0.32)"
    : isMilestone
      ? "0 2px 6px rgba(0,0,0,0.06)"
      : "0 1px 2px rgba(0,0,0,0.03)";

  // Progress pill palette (mirrors the rollup color).
  const progressPill =
    disp === "green"
      ? { bg: "#EAF3DE", fg: "#3B6D11" }
      : disp === "yellow"
        ? { bg: "#FFF4C5", fg: "#A87700" }
        : disp === "red"
          ? { bg: "#FADCDA", fg: "#A32D2D" }
          : { bg: "#E7EFFA", fg: "#1F4E82" };

  // Meta line — kind-specific rollup line under the title.
  let metaText = "";
  if (isMilestone) {
    const pct = total > 0 ? Math.round((touched / total) * 100) : 0;
    metaText = total > 0 ? `${pct}% shipped` : "no children yet";
    if (pendingRollup > 0) metaText += ` · ${pendingRollup} need review`;
  } else if (isGoal || isSub) {
    const owner = assignee || "unassigned";
    metaText = total > 0 ? `${owner} · ${touched}/${total}` : owner;
    if (node.score != null) metaText += ` · ${node.score}`;
  } else {
    metaText = assignee || "unassigned";
    if (node.score != null) metaText += ` · ${node.score}`;
  }

  return (
    <div
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: cardW,
        height: cardHeight,
        background: cardBg,
        borderRadius: 10,
        border: `${borderWidth}px solid ${borderColor}`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        padding: `${stripeH + 5}px 9px 6px 9px`,
        cursor: "pointer",
        boxShadow: shadow,
        transition: "box-shadow .15s, transform .15s",
        overflow: "hidden",
      }}
      onClick={() => onOpen(node.id)}
    >
      {/* Top status stripe — worst-child rollup color, capped rounded top */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          height: stripeH,
          background: hasPendingHere ? "#E9A100" : rollupBar,
          borderTopLeftRadius: 9,
          borderTopRightRadius: 9,
        }}
      />

      {/* Header: kind badge + right-side pills */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
        <span
          style={{
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: 0.6,
            color: "#5F5E5A",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {kindLabel}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {progressText && (
            <span
              title="descendants touched"
              style={{
                fontSize: 8.5,
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: 8,
                background: progressPill.bg,
                color: progressPill.fg,
                lineHeight: 1.4,
              }}
            >
              {progressText}
            </span>
          )}
          {directPendingKids > 0 && (
            <span
              title={`${directPendingKids} direct children have pending review`}
              style={{
                fontSize: 7.5,
                fontWeight: 800,
                padding: "1px 5px",
                borderRadius: 8,
                background: "#E9A100",
                color: "#FFFFFF",
                letterSpacing: 0.3,
                lineHeight: 1.4,
              }}
            >
              {directPendingKids} NEW
            </span>
          )}
          {directPendingKids === 0 && pendingRollup > 0 && !hasPendingHere && (
            <span
              title={`${pendingRollup} pending review below this card`}
              style={{
                fontSize: 8,
                fontWeight: 700,
                padding: "1px 5px",
                borderRadius: 8,
                background: "transparent",
                color: "#A87700",
                border: "1px dashed #D6B84A",
                lineHeight: 1.4,
              }}
            >
              {pendingRollup} below
            </span>
          )}
          {hasPendingHere && (
            <span
              title={`${node.pending_attachment_count} awaiting review on this card`}
              style={{
                fontSize: 8,
                fontWeight: 800,
                padding: "1px 5px",
                borderRadius: 8,
                background: "#E9A100",
                color: "#FFFFFF",
                letterSpacing: 0.3,
                lineHeight: 1.4,
              }}
            >
              {node.pending_attachment_count} REVIEW
            </span>
          )}
        </span>
      </div>

      {/* Title — single line ellipsis to keep the card tidy */}
      <div
        style={{
          fontSize: titleSize,
          fontWeight: titleWeight,
          color: "#2C2C2A",
          lineHeight: 1.28,
          marginTop: 2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={node.title}
      >
        {node.title}
      </div>

      {/* Meta line */}
      <div
        style={{
          marginTop: "auto",
          fontSize: 9,
          color: "#7A7972",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {metaText}
      </div>
      {hasKids && (
        <button type="button"
          title={isExpanded ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.id);
          }}
          style={{
            position: "absolute",
            top: -11,
            right: 8,
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: "0.5px solid #D3D1C7",
            background: "#fff",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            lineHeight: "20px",
            color: "#5F5E5A",
            padding: 0,
            zIndex: 3,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          {isExpanded ? "−" : "+"}
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
export function NodeModal({
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
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
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
      if (next) toast("Marked reviewed", "success");
    } catch (e) {
      const msg = handleApiError(e);
      // Server rejects with 422 when node lacks score or feedback — surface
      // that message directly so the user knows what to add.
      toast(msg, "error");
    }
  }

  async function download(attId: string) {
    try {
      const { url } = await (await fetch(`/api/milestone-nodes/attachments/${attId}/url`)).json();
      if (!url) throw new Error("Could not generate download link");
      window.open(url, "_blank");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function addSubtask() {
    const t = newSubtaskTitle.trim();
    if (!t) return;
    setAddingSubtask(true);
    try {
      await apiPost("/api/milestone-nodes", {
        parent_id: node.id,
        kind: "Sub-task",
        title: t,
        sort_order: node.children.length,
      });
      setNewSubtaskTitle("");
      invalidateCache("/api/milestone-nodes");
      await onRefetchTree();
      toast("Sub-task added", "success");
    } catch (e) {
      toast(handleApiError(e), "error");
    } finally {
      setAddingSubtask(false);
    }
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
              them reviewed. Reviewing requires the task to have a score AND
              at least one feedback message (both server-enforced). */}
          <div>
            {/* Review-gate check. Uses saved node values (not the draft in the
                Edit fields), because reviewing is an action on saved state. */}
            {(() => null)()}
            {/* Gate hint banner + condition */}
            {(() => {
              const _pending = (attachments || []).filter((a) => a.reviewed !== true).length;
              const _canReview = node.score != null && (feedback || []).length > 0;
              if (_pending > 0 && !_canReview) {
                const missing = [];
                if (node.score == null) missing.push("a score");
                if ((feedback || []).length === 0) missing.push("at least one feedback message");
                return (
                  <div className="mb-2 px-2.5 py-1.5 text-[10.5px] rounded-md bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-300">
                    Add {missing.join(" and ")} above before submissions can be marked reviewed.
                  </div>
                );
              }
              return null;
            })()}
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                Submissions ({attachments?.length || 0})
                {(attachments || []).some((a) => a.reviewed !== true) && (
                  <span className="ml-2 text-[9.5px] font-bold text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-1.5 py-0.5">
                    {(attachments || []).filter((a) => a.reviewed !== true).length} pending
                  </span>
                )}
                {(attachments || []).some((a) => a.reviewed === true) && (
                  <span className="ml-2 text-[9.5px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 rounded-full px-1.5 py-0.5">
                    ✓ {(attachments || []).filter((a) => a.reviewed === true).length} reviewed
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
                  const canReview = node.score != null && (feedback || []).length > 0;
                  const scoreC = node.score != null ? COLORS[scoreColorSafe(node.score) || "grey"] : null;

                  // Row styling: pending gets full amber; reviewed gets a
                  // score-tinted left bar so the row itself says "green: strong,
                  // yellow: ok, red: needs work" alongside the REVIEWED label.
                  const bg = isPending
                    ? "bg-amber-50/70 dark:bg-amber-900/10 border-l-4 border-amber-400"
                    : scoreC
                      ? "border-l-4"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/40";
                  const reviewedBorderColor = !isPending && scoreC ? scoreC.bar : undefined;
                  const reviewedBg = !isPending && scoreC ? scoreC.pill + "80" : undefined;

                  return (
                    <li
                      key={a.id}
                      className={`py-1.5 px-2 rounded-md group ${bg}`}
                      style={
                        !isPending && scoreC
                          ? { borderLeftColor: reviewedBorderColor, background: reviewedBg }
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm flex-shrink-0" title={a.kind || "file"}>
                          {isLink ? "🔗" : isText ? "📝" : "📎"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <p className="text-xs text-gray-700 dark:text-gray-300 truncate font-medium">{a.filename}</p>
                            {isPending && (
                              <span className="text-[8.5px] font-bold text-amber-800 bg-amber-200 rounded px-1.5 py-0.5 flex-shrink-0">
                                NEW · needs review
                              </span>
                            )}
                            {!isPending && scoreC && (
                              <>
                                <span
                                  className="text-[9px] font-bold rounded px-1.5 py-0.5 flex-shrink-0"
                                  style={{ background: scoreC.bar, color: "#FFFFFF" }}
                                  title="Task score at time of review"
                                >
                                  ✓ REVIEWED · {node.score}/10
                                </span>
                              </>
                            )}
                          </div>
                          <p className="text-[9px] text-gray-400 truncate">
                            {a.uploaded_by} · {formatShort(a.uploaded_at)}
                            {a.size_bytes ? ` · ${humanBytes(a.size_bytes)}` : ""}
                            {!isPending && a.reviewed_at && (
                              <> · reviewed {formatShort(a.reviewed_at)}</>
                            )}
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
                            disabled={!canReview}
                            title={
                              canReview
                                ? "Mark reviewed"
                                : "Add a score and at least one feedback message to enable review"
                            }
                            className={`px-1.5 py-0.5 text-[9.5px] font-semibold rounded flex-shrink-0 ${
                              canReview
                                ? "text-emerald-700 bg-emerald-100 hover:bg-emerald-200"
                                : "text-gray-400 bg-gray-100 cursor-not-allowed"
                            }`}
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

          {/* Sub-tasks — only shown when this node is a Task. Sub-tasks are
              leaves (Task → Sub-task), so this is the only place they get
              created from the modal. */}
          {node.kind === "Task" && (
            <div>
              <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">
                Sub-tasks ({node.children.length})
              </p>
              {node.children.length === 0 ? (
                <p className="text-xs text-gray-400 italic mb-2">No sub-tasks yet.</p>
              ) : (
                <ul className="space-y-1 mb-2">
                  {node.children.map((c) => {
                    const st = ownStatus(c);
                    return (
                      <li
                        key={c.id}
                        className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer text-xs"
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: STATUS_HEX[st],
                            flexShrink: 0,
                          }}
                        />
                        <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{c.title}</span>
                        {c.score != null && (
                          <span className="text-[10px] text-gray-500 flex-shrink-0">{c.score}/10</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {isDoer && (
                <div className="flex gap-2">
                  <input
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && newSubtaskTitle.trim()) addSubtask(); }}
                    placeholder="New sub-task…"
                    disabled={addingSubtask}
                    className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <button
                    type="button"
                    onClick={addSubtask}
                    disabled={!newSubtaskTitle.trim() || addingSubtask}
                    className="px-3 py-1.5 text-xs bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white rounded-lg transition-all"
                  >
                    + Add sub-task
                  </button>
                </div>
              )}
            </div>
          )}

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

