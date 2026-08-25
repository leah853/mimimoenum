"use client";

import { useCallback, useEffect, useState } from "react";
import { HiOutlineTrash } from "react-icons/hi";

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  created_by: string;
  created_at: string;
}

/**
 * Ops / infra support checklist for one planner card. The same items appear in
 * the Feedback Trail's Ops Checklist tab and can be ticked off from either
 * place, so this reloads from the server rather than trusting local state.
 */
export default function PlannerItemChecklist({
  itemId,
  boardParam,
  canEdit,
}: {
  itemId: string;
  boardParam: string | null;
  canEdit: boolean;
}) {
  const suffix = boardParam ? `?board=${encodeURIComponent(boardParam)}` : "";
  const base = `/api/planner/items/${itemId}/checklist`;

  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}${suffix}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setItems(Array.isArray(json) ? json : []);
      setError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setItems([]);
      setError(
        /planner_item_checklist|schema cache|does not exist/i.test(message)
          ? "Checklist needs a migration: run supabase/migrations/20260825_planner_item_checklist.sql."
          : `Could not load the checklist. ${message}`
      );
    }
  }, [base, suffix]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  async function add() {
    if (!label.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${base}${suffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setLabel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add item");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: ChecklistItem) {
    // Optimistic: ticking should feel instant, and load() reconciles after.
    setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) ?? prev);
    try {
      const res = await fetch(`/api/planner/checklist/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !item.done }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update item");
      await load();
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/planner/checklist/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove item");
    }
  }

  const done = items?.filter((i) => i.done).length ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-gray-500">
          Ops / infra support{items?.length ? ` (${done}/${items.length})` : ""}
        </span>
      </div>

      {error && (
        <p className="text-[11.5px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-lg px-2.5 py-1.5 mb-1.5">
          {error}
        </p>
      )}

      {items === null ? (
        <p className="text-[11.5px] text-gray-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[11.5px] text-gray-400 mb-1.5">No support items yet.</p>
      ) : (
        <ul className="space-y-0.5 mb-1.5">
          {items.map((i) => (
            <li key={i.id} className="group flex items-start gap-2 py-0.5">
              <input
                type="checkbox"
                checked={i.done}
                onChange={() => toggle(i)}
                className="mt-0.5 shrink-0 accent-indigo-600 cursor-pointer"
                aria-label={i.label}
              />
              <span
                className={`text-[12px] flex-1 break-words ${
                  i.done ? "line-through text-gray-400" : "text-gray-700 dark:text-gray-200"
                }`}
              >
                {i.label}
                {i.done && i.done_by && (
                  <span className="ml-1 text-[10px] text-gray-400 no-underline">· {i.done_by}</span>
                )}
              </span>
              {canEdit && (
                <button type="button" onClick={() => remove(i.id)} title="Remove"
                  className="opacity-0 group-hover:opacity-100 shrink-0 text-gray-300 hover:text-red-500">
                  <HiOutlineTrash className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex gap-1.5">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
            placeholder="Add a support item…"
            className="flex-1 text-[12px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2.5 py-1.5 outline-none focus:border-indigo-400"
          />
          <button type="button" onClick={add} disabled={busy || !label.trim()}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-indigo-600 text-white disabled:opacity-40">Add</button>
        </div>
      )}
    </div>
  );
}
