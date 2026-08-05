"use client";

import { useEffect, useState } from "react";
import MilestoneTree from "@/components/MilestoneTree";

type ViewMode = "pine" | "dashboard";
const STORAGE_KEY = "mimimoenum:tree-view";

export default function MilestonesPage() {
  const [view, setView] = useState<ViewMode>("pine");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "pine" || saved === "dashboard") setView(saved);
      else if (saved === "outline") setView("pine");
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, view); } catch {}
  }, [view, ready]);

  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Milestones</h1>
          <p className="text-xs text-gray-500 mt-1">
            Hierarchical Milestone → Goal → Sub-goal → Task tree with per-node
            feedback and attachments.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Tree view mode"
          className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 p-0.5 text-[12px]"
        >
          {(["pine", "dashboard"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={view === m}
              onClick={() => setView(m)}
              className={`px-3 py-1 rounded-full transition-all ${
                view === m
                  ? "bg-white dark:bg-gray-900 text-indigo-600 shadow-sm font-semibold"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {m === "pine" ? "Pine" : "Dashboard"}
            </button>
          ))}
        </div>
      </div>
      <MilestoneTree viewMode={view} />
    </div>
  );
}
