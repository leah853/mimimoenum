"use client";

import { useState } from "react";
import { apiPost, apiDelete, invalidateCache } from "@/lib/use-api";
import { handleApiError } from "@/lib/utils";
import { useToast } from "@/components/ui";

type User = { id: string; full_name: string; email?: string };

export default function OwnerPickerModal({
  title,
  subtitle,
  entityType,
  entityId,
  users,
  existingMappingId,
  initialPrimary,
  initialSecondary,
  onClose,
  onSaved,
}: {
  title: string;
  subtitle?: string;
  entityType: "AREA" | "MILESTONE";
  entityId: string;
  users: User[];
  existingMappingId: string | null;
  initialPrimary: string | null;
  initialSecondary: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [primary, setPrimary] = useState<string>(initialPrimary || "");
  const [secondary, setSecondary] = useState<string>(initialSecondary || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  const sameError = primary && secondary && primary === secondary;

  async function save() {
    if (!primary) { setError("Primary owner is required."); return; }
    if (sameError) { setError("Primary and secondary must be different."); return; }
    setSaving(true);
    setError("");
    try {
      await apiPost("/api/ownership-map", {
        entity_type: entityType,
        entity_id: entityId,
        primary_owner_user_id: primary,
        secondary_owner_user_id: secondary || null,
      });
      invalidateCache("/api/ownership-map");
      toast("Ownership saved", "success");
      onSaved();
      onClose();
    } catch (e) {
      setError(handleApiError(e));
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!existingMappingId) { onClose(); return; }
    if (!confirm("Clear ownership for this entry? It will become Unassigned.")) return;
    setSaving(true);
    try {
      await apiDelete(`/api/ownership-map/${existingMappingId}`);
      invalidateCache("/api/ownership-map");
      toast("Ownership cleared", "success");
      onSaved();
      onClose();
    } catch (e) {
      setError(handleApiError(e));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200/60 dark:border-gray-700/60 rounded-2xl p-6 shadow-2xl w-full max-w-md space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
          {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Primary Owner *</label>
          <select value={primary} onChange={(e) => setPrimary(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white">
            <option value="">— Select —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Secondary Owner <span className="text-gray-400">(optional)</span></label>
          <select value={secondary} onChange={(e) => setSecondary(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white">
            <option value="">— None —</option>
            {users.filter((u) => u.id !== primary).map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
        </div>

        {(error || sameError) && (
          <p className="text-xs text-red-500">{error || "Primary and secondary must be different."}</p>
        )}

        <div className="flex gap-3 justify-end pt-2">
          {existingMappingId && (
            <button onClick={clear} disabled={saving}
              className="mr-auto px-3 py-2 text-xs text-red-500 hover:text-red-400 rounded-lg transition-all">
              Clear ownership
            </button>
          )}
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !primary || Boolean(sameError)}
            className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 text-white text-sm rounded-xl shadow-md transition-all active:scale-[0.97]">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
