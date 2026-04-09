"use client";

import { useState } from "react";
import { apiPost, apiDelete } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { HiPencil, HiX, HiCheck } from "react-icons/hi";
import { useToast } from "@/components/ui";
import { handleApiError } from "@/lib/utils";

interface ScoreOverride {
  target_type: string;
  target_id: string;
  score: number;
}

interface ScoreEditorProps {
  targetType: "quarter" | "iteration" | "week";
  targetId: string;
  cumulativeScore: number;
  override?: ScoreOverride | null;
  onUpdate: () => void;
  size?: "sm" | "lg";
}

export default function ScoreEditor({ targetType, targetId, cumulativeScore, override, onUpdate, size = "sm" }: ScoreEditorProps) {
  const { dbUser } = useAuth();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(override?.score?.toString() || "");
  const [saving, setSaving] = useState(false);

  const canEdit = dbUser?.role === "admin" || dbUser?.role === "mimimomentum";
  const displayScore = override ? override.score : cumulativeScore;
  const isOverridden = !!override;

  const bg = displayScore >= 7
    ? "from-green-500 to-emerald-500"
    : displayScore > 0
    ? "from-yellow-500 to-amber-500"
    : "from-gray-400 to-gray-500";

  const cls = size === "lg" ? "text-sm font-bold px-3 py-1" : "text-[10px] font-bold px-2 py-0.5";

  async function save() {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0 || num > 10) return;
    setSaving(true);
    try {
      await apiPost("/api/scores", {
        target_type: targetType,
        target_id: targetId,
        score: num,
        set_by: dbUser?.id || null,
      });
      onUpdate();
      setEditing(false);
    } catch (e) { toast(handleApiError(e), "error"); }
    setSaving(false);
  }

  async function revert() {
    setSaving(true);
    try {
      await apiDelete(`/api/scores?target_type=${targetType}&target_id=${targetId}`);
      onUpdate();
      setEditing(false);
      setValue("");
    } catch (e) { toast(handleApiError(e), "error"); }
    setSaving(false);
  }

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-14 px-1.5 py-0.5 bg-gray-50 dark:bg-gray-800 border border-indigo-300 dark:border-indigo-600 rounded-lg text-xs text-gray-900 dark:text-white text-center focus:ring-1 focus:ring-indigo-500"
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          autoFocus
        />
        <button onClick={save} disabled={saving} className="text-green-500 hover:text-green-400"><HiCheck className="w-3.5 h-3.5" /></button>
        <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600"><HiX className="w-3.5 h-3.5" /></button>
        {isOverridden && (
          <button onClick={revert} className="text-[9px] text-gray-400 hover:text-red-400 ml-1" title="Revert to cumulative">↺</button>
        )}
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 group">
      <span className={`rounded-full bg-gradient-to-r ${bg} text-white ${cls}`}>
        {displayScore.toFixed(1)}/10
      </span>
      {isOverridden && (
        <span className="text-[8px] text-indigo-400" title="Manually set">✎</span>
      )}
      {canEdit && (
        <button
          onClick={() => { setValue(displayScore.toFixed(1)); setEditing(true); }}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-500 transition-all"
          title="Override score"
        >
          <HiPencil className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
