"use client";

import { useMemo, useState } from "react";
import { useApi, apiPatch, apiDelete, invalidateCache } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { useToast, SkeletonRows } from "@/components/ui";
import { handleApiError } from "@/lib/utils";
import {
  HiOutlinePaperClip,
  HiOutlineLink,
  HiOutlineDocumentText,
  HiChevronRight,
  HiChevronDown,
  HiOutlineDownload,
  HiOutlineExternalLink,
} from "react-icons/hi";
import { NodeModal, type ApiNode, type TreeNode } from "@/components/MilestoneTree";

type Item = {
  attachment_id: string;
  node_id: string;
  node_title: string;
  node_score: number | null;
  goal_id: string | null;
  goal_title: string;
  path: string[];
  kind: "file" | "link" | "text";
  filename: string;
  link_url: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  uploaded_at: string;
  reviewed: boolean;
  reviewed_at: string | null;
};

type GoalMeta = { id: string; title: string; label: string; icon: string; bar: string; pill: string; pillText: string };

// Fuzzy-map goal titles → visual identity for the three cards. Falls back to a
// neutral treatment for anything else (e.g. the "Unplaced plan tasks" bucket).
const GOAL_CARDS: GoalMeta[] = [
  {
    id: "apex",
    title: "Milestone and Branding",
    label: "Milestone and branding",
    icon: "target",
    bar: "#185FA5",
    pill: "#E6F1FB",
    pillText: "#0C447C",
  },
  {
    id: "platform",
    title: "Product, Workflows and Fedramp",
    label: "Product, workflows and fedramp",
    icon: "settings",
    bar: "#0F6E56",
    pill: "#E1F5EE",
    pillText: "#085041",
  },
  {
    id: "people",
    title: "Talent and Knowledge & Culture",
    label: "Talent, knowledge and culture",
    icon: "users",
    bar: "#534AB7",
    pill: "#EEEDFE",
    pillText: "#3C3489",
  },
];

function matchGoal(title: string): GoalMeta | null {
  const t = title.toLowerCase();
  if (t.includes("milestone") || t.includes("branding")) return GOAL_CARDS[0];
  if (t.includes("product") || t.includes("platform") || t.includes("workflow") || t.includes("fedramp") || t.includes("engine")) return GOAL_CARDS[1];
  if (t.includes("talent") || t.includes("knowledge") || t.includes("culture") || t.includes("people")) return GOAL_CARDS[2];
  return null;
}

function statusPill(score: number | null, reviewed: boolean) {
  if (!reviewed) return { text: "NEW · needs review", bg: "#FAEEDA", fg: "#854F0B" };
  if (score == null) return { text: "Reviewed", bg: "#EEEDFE", fg: "#3C3489" };
  if (score >= 9) return { text: `Reviewed · ${score}/10`, bg: "#EAF3DE", fg: "#3B6D11" };
  if (score >= 6) return { text: `Reviewed · ${score}/10`, bg: "#FAEEDA", fg: "#854F0B" };
  return { text: `Reviewed · ${score}/10`, bg: "#FCEBEB", fg: "#A32D2D" };
}

function monthKey(iso: string) {
  return iso.slice(0, 7); // "2026-06"
}
function monthLabel(key: string) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}
function dayLabel(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric" });
}
function humanBytes(n?: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Show months from June 2026 forward.
const MIN_MONTH = "2026-06";

export default function DeliverablesPage() {
  const { data, loading, refetch } = useApi<{ items: Item[] }>("/api/milestone-nodes/deliverables");
  const { data: allNodes } = useApi<ApiNode[]>("/api/milestone-nodes");
  const { dbUser, appRole } = useAuth();
  const { toast } = useToast();
  const isDoer = appRole === "doer" || appRole === "admin";

  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // "<goal_id>|<month>"
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);

  const items = data?.items || [];

  // Group items by goal card → month key.
  const byCard = useMemo(() => {
    const buckets = new Map<string, { meta: GoalMeta; months: Map<string, Item[]>; total: number; pending: number }>();
    for (const card of GOAL_CARDS) {
      buckets.set(card.id, { meta: card, months: new Map(), total: 0, pending: 0 });
    }
    for (const item of items) {
      const meta = matchGoal(item.goal_title);
      if (!meta) continue;
      const mkey = monthKey(item.uploaded_at);
      if (mkey < MIN_MONTH) continue;
      const bucket = buckets.get(meta.id)!;
      const arr = bucket.months.get(mkey) || [];
      arr.push(item);
      bucket.months.set(mkey, arr);
      bucket.total += 1;
      if (!item.reviewed) bucket.pending += 1;
    }
    return Array.from(buckets.values());
  }, [items]);

  const totalCount = byCard.reduce((s, b) => s + b.total, 0);
  const minMonth = items.length ? items.map((i) => monthKey(i.uploaded_at)).filter((k) => k >= MIN_MONTH).sort()[0] : null;
  const maxMonth = items.length ? items.map((i) => monthKey(i.uploaded_at)).filter((k) => k >= MIN_MONTH).sort().slice(-1)[0] : null;
  const range = minMonth && maxMonth ? `${monthLabel(minMonth)}–${monthLabel(maxMonth)}` : "";

  // Build a TreeNode lookup from allNodes so we can hand a full node to NodeModal.
  const treeNodeById = useMemo(() => {
    const raw = allNodes || [];
    const map = new Map<string, TreeNode>();
    for (const n of raw) {
      map.set(n.id, {
        ...n,
        children: [],
        attachmentCount: n.attachment_count,
      });
    }
    // wire children so ownStatus / paths still work if NodeModal peeks
    for (const n of raw) {
      if (n.parent_id) {
        const p = map.get(n.parent_id);
        const c = map.get(n.id);
        if (p && c) p.children.push(c);
      }
    }
    return map;
  }, [allNodes]);

  const openNode = openNodeId ? treeNodeById.get(openNodeId) || null : null;

  // Path from Milestone → the open node (used for the modal breadcrumb).
  const openNodePath = useMemo(() => {
    if (!openNode) return [];
    const chain: string[] = [];
    let cur: TreeNode | null | undefined = openNode;
    while (cur) {
      if (cur.parent_id) {
        const p: TreeNode | undefined = treeNodeById.get(cur.parent_id);
        if (p) chain.push(p.title);
        cur = p;
      } else break;
    }
    return chain.reverse();
  }, [openNode, treeNodeById]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  async function updateNode(id: string, patch: Partial<ApiNode>) {
    try {
      await apiPatch(`/api/milestone-nodes/${id}`, patch);
      invalidateCache("/api/milestone-nodes");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function deleteNode(id: string) {
    if (!confirm("Delete this node and everything under it?")) return;
    try {
      await apiDelete(`/api/milestone-nodes/${id}`);
      if (openNodeId === id) setOpenNodeId(null);
      invalidateCache("/api/milestone-nodes");
      await refetch();
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  async function download(item: Item) {
    try {
      const res = await fetch(`/api/milestone-nodes/attachments/${item.attachment_id}/url`);
      const j = await res.json();
      if (!j.url) throw new Error("Could not generate download link");
      window.open(j.url, "_blank");
    } catch (e) { toast(handleApiError(e), "error"); }
  }

  function kindIcon(kind: Item["kind"]) {
    if (kind === "link") return <HiOutlineLink className="w-3 h-3 text-gray-500 flex-shrink-0" />;
    if (kind === "text") return <HiOutlineDocumentText className="w-3 h-3 text-gray-500 flex-shrink-0" />;
    return <HiOutlinePaperClip className="w-3 h-3 text-gray-500 flex-shrink-0" />;
  }

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deliverables</h1>
          <p className="text-xs text-gray-500 mt-1">
            All submissions across the three goals, grouped by upload month. Click any item for the full node view.
          </p>
        </div>
        {totalCount > 0 && (
          <span className="text-xs text-gray-500">
            {totalCount} item{totalCount === 1 ? "" : "s"}{range ? ` · ${range}` : ""}
          </span>
        )}
      </div>

      {loading && <SkeletonRows count={4} />}

      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {byCard.map(({ meta, months, total, pending }) => {
            const sortedMonths = Array.from(months.keys()).sort();
            return (
              <div
                key={meta.id}
                className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl p-3"
                style={{ borderTop: `3px solid ${meta.bar}` }}
              >
                <div className="mb-3">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-tight">{meta.label}</p>
                  <p className="text-[10.5px] text-gray-500 mt-0.5">
                    {total} total{pending > 0 ? ` · ${pending} pending` : ""}
                  </p>
                </div>

                {sortedMonths.length === 0 && (
                  <p className="text-[11px] text-gray-400 italic">No submissions yet in this bucket.</p>
                )}

                <div className="space-y-1">
                  {sortedMonths.map((mkey) => {
                    const key = `${meta.id}|${mkey}`;
                    const isOpen = expanded.has(key);
                    const monthItems = months.get(mkey) || [];
                    return (
                      <div key={mkey}>
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-left transition-colors hover:brightness-105"
                          style={{ background: meta.pill, color: meta.pillText }}
                        >
                          <span className="flex items-center gap-1 text-[11px] font-medium">
                            {isOpen ? <HiChevronDown className="w-3 h-3" /> : <HiChevronRight className="w-3 h-3" />}
                            {monthLabel(mkey)}
                          </span>
                          <span className="text-[11px] font-semibold">{monthItems.length}</span>
                        </button>

                        {isOpen && (
                          <ul className="mt-1 pl-1 space-y-2">
                            {monthItems.map((it) => {
                              const pill = statusPill(it.node_score, it.reviewed);
                              return (
                                <li key={it.attachment_id}>
                                  <button
                                    type="button"
                                    onClick={() => setOpenNodeId(it.node_id)}
                                    className="w-full text-left"
                                  >
                                    <div className="flex items-baseline gap-1.5 text-[10.5px] group">
                                      {kindIcon(it.kind)}
                                      <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-200 group-hover:text-indigo-600">
                                        {it.filename}
                                      </span>
                                      <span className="text-[9.5px] text-gray-400 flex-shrink-0">{dayLabel(it.uploaded_at)}</span>
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5 pl-4 flex-wrap">
                                      <span
                                        className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                                        style={{ background: pill.bg, color: pill.fg }}
                                      >
                                        {pill.text}
                                      </span>
                                      {it.node_title && (
                                        <span className="text-[9px] text-gray-400 truncate">· {it.node_title}</span>
                                      )}
                                    </div>
                                  </button>
                                  {/* Quick open/download without popping the modal */}
                                  {(it.kind === "file" || it.kind === "link") && (
                                    <div className="pl-4 mt-0.5">
                                      {it.kind === "file" ? (
                                        <button
                                          type="button"
                                          onClick={() => download(it)}
                                          className="inline-flex items-center gap-1 text-[9px] text-gray-400 hover:text-blue-600"
                                        >
                                          <HiOutlineDownload className="w-2.5 h-2.5" /> download
                                        </button>
                                      ) : (
                                        it.link_url && (
                                          <a
                                            href={it.link_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-[9px] text-blue-500 hover:text-blue-700"
                                          >
                                            <HiOutlineExternalLink className="w-2.5 h-2.5" /> open link
                                          </a>
                                        )
                                      )}
                                      {humanBytes(it.size_bytes) && (
                                        <span className="ml-2 text-[9px] text-gray-400">{humanBytes(it.size_bytes)}</span>
                                      )}
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openNode && (
        <NodeModal
          node={openNode}
          path={openNodePath}
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
