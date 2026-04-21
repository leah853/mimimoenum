"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/use-api";
import { useAuth } from "@/lib/auth-context";
import { canEditOwnerMaps } from "@/lib/roles";
import { FUNCTIONAL_AREAS, type AreaSlug } from "@/lib/functional-areas";
import { OWNER_STYLE } from "@/lib/constants";
import { SkeletonRows } from "@/components/ui";
import { HiPencil } from "react-icons/hi";
import OwnerPickerModal from "@/components/OwnerPickerModal";

type UserRow = { id: string; full_name: string; email: string };
type QuarterGoal = { id: string; category: string; goal: string; quarter_id: string; sort_order?: number };

type OwnershipRow = {
  id: string;
  entity_type: "AREA" | "MILESTONE";
  entity_id: string;
  primary_owner_user_id: string;
  secondary_owner_user_id: string | null;
  primary_owner: UserRow | null;
  secondary_owner: UserRow | null;
};

function OwnerPill({ user, role }: { user: UserRow | null; role: "primary" | "secondary" }) {
  if (!user) return <span className="text-[11px] italic text-gray-400">Unassigned</span>;
  const style = OWNER_STYLE[user.full_name];
  const bg = style?.bg || "bg-gray-100 dark:bg-gray-800";
  const text = style?.text || "text-gray-700 dark:text-gray-300";
  const dot = style?.dot || "#9CA3AF";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] ${bg} ${text}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dot }} />
      {user.full_name}
      {role === "secondary" && <span className="text-[9px] opacity-60">backup</span>}
    </span>
  );
}

// Build human-readable sentences describing ownership coverage.
function buildSummary(areaMaps: OwnershipRow[]): string[] {
  const byOwner = new Map<string, { name: string; primary: string[]; backup: string[] }>();
  const unassigned: string[] = [];

  for (const area of FUNCTIONAL_AREAS) {
    const m = areaMaps.find((x) => x.entity_id === area.slug);
    if (!m || !m.primary_owner) {
      unassigned.push(area.label);
      continue;
    }
    const p = m.primary_owner;
    if (!byOwner.has(p.id)) byOwner.set(p.id, { name: p.full_name, primary: [], backup: [] });
    byOwner.get(p.id)!.primary.push(area.label);
    if (m.secondary_owner) {
      const s = m.secondary_owner;
      if (!byOwner.has(s.id)) byOwner.set(s.id, { name: s.full_name, primary: [], backup: [] });
      byOwner.get(s.id)!.backup.push(area.label);
    }
  }

  const lines: string[] = [];
  const sortedOwners = [...byOwner.values()].sort((a, b) => b.primary.length - a.primary.length);
  for (const o of sortedOwners) {
    if (o.primary.length === 0 && o.backup.length === 0) continue;
    const parts: string[] = [];
    if (o.primary.length > 0) {
      parts.push(`leads ${joinList(o.primary)}`);
    }
    if (o.backup.length > 0) {
      parts.push(`backs up ${joinList(o.backup)}`);
    }
    lines.push(`${o.name} ${parts.join(" and ")}.`);
  }
  if (unassigned.length > 0) {
    lines.push(`${joinList(unassigned)} ${unassigned.length === 1 ? "is" : "are"} currently unassigned.`);
  }
  if (lines.length === 0) lines.push("No ownership has been set yet. Admins can start assigning below.");
  return lines;
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export default function OwnerMaps() {
  const { appRole } = useAuth();
  const canEdit = canEditOwnerMaps(appRole);

  const { data: mapsData, loading: mapsLoading, refetch: refetchMaps } = useApi<OwnershipRow[]>("/api/ownership-map");
  const { data: usersData } = useApi<UserRow[]>("/api/users");
  const { data: goalsData } = useApi<QuarterGoal[]>("/api/quarter-goals");

  const maps = mapsData || [];
  const users = useMemo(() => (usersData || []).filter((u) => u.email && !u.email.endsWith("@mimimomentum.com")), [usersData]);
  const goals = goalsData || [];

  const [view, setView] = useState<"area" | "milestone">("area");
  const [editing, setEditing] = useState<null | { entityType: "AREA" | "MILESTONE"; entityId: string; title: string; subtitle?: string; mapping: OwnershipRow | null }>(null);

  const areaMaps = useMemo(() => maps.filter((m) => m.entity_type === "AREA"), [maps]);
  const milestoneMaps = useMemo(() => maps.filter((m) => m.entity_type === "MILESTONE"), [maps]);

  const summary = useMemo(() => buildSummary(areaMaps), [areaMaps]);

  function findAreaMap(slug: AreaSlug) {
    return areaMaps.find((m) => m.entity_id === slug) || null;
  }
  function findMilestoneMap(goalId: string) {
    return milestoneMaps.find((m) => m.entity_id === goalId) || null;
  }

  if (mapsLoading) return <div className="space-y-4"><div className="skeleton h-20 rounded-2xl" /><SkeletonRows count={6} /></div>;

  return (
    <div className="space-y-4">
      {/* Summary statements */}
      <div className="bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-900/15 dark:to-violet-900/10 border border-indigo-200/60 dark:border-indigo-800/30 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">🧭</span>
          <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Ownership Summary</h3>
        </div>
        <ul className="space-y-1.5">
          {summary.map((line, i) => (
            <li key={i} className="text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed">• {line}</li>
          ))}
        </ul>
        {!canEdit && (
          <p className="text-[10px] text-gray-400 mt-3">Read-only view. Only admins can edit ownership.</p>
        )}
      </div>

      {/* Sub-view switcher */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        <button onClick={() => setView("area")}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-all ${view === "area" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          By Functional Area
        </button>
        <button onClick={() => setView("milestone")}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-all ${view === "milestone" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
          By Milestone ({goals.length})
        </button>
      </div>

      {/* By Area */}
      {view === "area" && (
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Functional Area</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Primary Owner</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Secondary Owner</th>
                {canEdit && <th className="w-16"></th>}
              </tr>
            </thead>
            <tbody>
              {FUNCTIONAL_AREAS.map((area) => {
                const m = findAreaMap(area.slug);
                return (
                  <tr key={area.slug} className="border-b border-gray-100 dark:border-gray-800/40 last:border-b-0 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-colors">
                    <td className="px-4 py-2.5">
                      <div>
                        <p className="text-sm text-gray-900 dark:text-white font-medium">{area.label}</p>
                        <p className="text-[10px] text-gray-400">{area.legacyCategory}</p>
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><OwnerPill user={m?.primary_owner || null} role="primary" /></td>
                    <td className="px-4 py-2.5"><OwnerPill user={m?.secondary_owner || null} role="secondary" /></td>
                    {canEdit && (
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => setEditing({
                          entityType: "AREA", entityId: area.slug,
                          title: area.label, subtitle: "Assign owners for this area",
                          mapping: m,
                        })}
                          className="text-gray-400 hover:text-indigo-500 transition-colors p-1" title="Edit">
                          <HiPencil className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* By Milestone */}
      {view === "milestone" && (
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-gray-200/60 dark:border-gray-800/60 rounded-2xl overflow-hidden shadow-sm">
          {goals.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-500 mb-3">No milestones yet. Add quarter goals first to track ownership.</p>
              <Link href="/dashboard" className="text-xs text-indigo-500 hover:text-indigo-400">Go to Dashboard</Link>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Milestone</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Area</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Primary</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Secondary</th>
                  {canEdit && <th className="w-16"></th>}
                </tr>
              </thead>
              <tbody>
                {[...goals].sort((a, b) => a.category.localeCompare(b.category) || (a.sort_order || 0) - (b.sort_order || 0)).map((goal) => {
                  const m = findMilestoneMap(goal.id);
                  const area = FUNCTIONAL_AREAS.find((a) => a.legacyCategory === goal.category);
                  return (
                    <tr key={goal.id} className="border-b border-gray-100 dark:border-gray-800/40 last:border-b-0 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-colors">
                      <td className="px-4 py-2.5">
                        <p className="text-sm text-gray-900 dark:text-white">{goal.goal}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[11px] text-gray-500">{area?.short || goal.category}</span>
                      </td>
                      <td className="px-4 py-2.5"><OwnerPill user={m?.primary_owner || null} role="primary" /></td>
                      <td className="px-4 py-2.5"><OwnerPill user={m?.secondary_owner || null} role="secondary" /></td>
                      {canEdit && (
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => setEditing({
                            entityType: "MILESTONE", entityId: goal.id,
                            title: goal.goal, subtitle: area?.label || goal.category,
                            mapping: m,
                          })}
                            className="text-gray-400 hover:text-indigo-500 transition-colors p-1" title="Edit">
                            <HiPencil className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && (
        <OwnerPickerModal
          title={editing.title}
          subtitle={editing.subtitle}
          entityType={editing.entityType}
          entityId={editing.entityId}
          users={users}
          existingMappingId={editing.mapping?.id || null}
          initialPrimary={editing.mapping?.primary_owner_user_id || null}
          initialSecondary={editing.mapping?.secondary_owner_user_id || null}
          onClose={() => setEditing(null)}
          onSaved={() => refetchMaps()}
        />
      )}
    </div>
  );
}
