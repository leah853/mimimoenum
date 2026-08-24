"use client";

import { useEffect, useState } from "react";
import { STATUS_COLORS, STATUS_LABELS, type TaskStatus } from "@/lib/types";
import type { PlannerItem } from "@/lib/planner-model";

const STATUSES: TaskStatus[] = ["not_started", "in_progress", "under_review", "completed", "blocked"];

/**
 * Detail drawer for a single planner card. Edits apply immediately to the
 * board (which autosaves), so there is no explicit save button.
 */
export default function PlannerItemPanel({
  item,
  context,
  readOnly,
  onChange,
  onDelete,
  onClose,
}: {
  item: PlannerItem;
  /** Human-readable "Row · Quarter Iteration Week" trail. */
  context: string;
  readOnly: boolean;
  onChange: (next: PlannerItem) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Escape closes the drawer, matching the inline cell editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Close on press-start, not click: the backdrop mounts during the very
          click that opens the drawer, so a click handler here can receive that
          same gesture's mouseup and dismiss the drawer immediately. */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="Planner item"
        className="fixed right-0 top-0 bottom-0 z-50 w-[380px] max-w-[92vw] bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col"
      >
        <div className="px-5 py-4 border-b border-gray-200/70 dark:border-gray-800/70 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Planner item</p>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5 truncate" title={context}>
              {context}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-5">
          <div>
            <label htmlFor="planner-item-title" className="block text-[11px] font-semibold text-gray-500 mb-1.5">
              Title
            </label>
            <textarea
              id="planner-item-title"
              rows={2}
              readOnly={readOnly}
              value={item.title}
              onChange={(e) => onChange({ ...item, title: e.target.value })}
              placeholder="What needs to happen?"
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 outline-none focus:border-indigo-400 resize-none read-only:bg-gray-50 dark:read-only:bg-gray-900"
            />
          </div>

          <div>
            <span className="block text-[11px] font-semibold text-gray-500 mb-1.5">Status</span>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => {
                const active = item.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={readOnly}
                    onClick={() => onChange({ ...item, status: s })}
                    className="flex items-center gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-full border transition-all disabled:cursor-default"
                    style={{
                      borderColor: active ? STATUS_COLORS[s] : "transparent",
                      background: active ? `${STATUS_COLORS[s]}1F` : "rgba(127,127,127,0.08)",
                      color: active ? STATUS_COLORS[s] : undefined,
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[s] }} />
                    {STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="planner-item-owner" className="block text-[11px] font-semibold text-gray-500 mb-1.5">
              Owner
            </label>
            <input
              id="planner-item-owner"
              type="text"
              readOnly={readOnly}
              value={item.owner ?? ""}
              onChange={(e) => onChange({ ...item, owner: e.target.value })}
              placeholder="Who owns this?"
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 outline-none focus:border-indigo-400 read-only:bg-gray-50 dark:read-only:bg-gray-900"
            />
          </div>

          <div>
            <label htmlFor="planner-item-note" className="block text-[11px] font-semibold text-gray-500 mb-1.5">
              Notes
            </label>
            <textarea
              id="planner-item-note"
              rows={6}
              readOnly={readOnly}
              value={item.note ?? ""}
              onChange={(e) => onChange({ ...item, note: e.target.value })}
              placeholder="Detail, links, blockers…"
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 outline-none focus:border-indigo-400 resize-none read-only:bg-gray-50 dark:read-only:bg-gray-900"
            />
          </div>
        </div>

        {!readOnly && (
          <div className="px-5 py-3 border-t border-gray-200/70 dark:border-gray-800/70">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] text-gray-500 flex-1">Delete this item?</span>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-[11.5px] px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-[11.5px] px-2.5 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600"
                >
                  Delete
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-[11.5px] text-gray-400 hover:text-red-500 transition-colors"
              >
                Delete item
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
