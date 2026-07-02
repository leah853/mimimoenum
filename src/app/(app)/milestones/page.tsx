"use client";

import MilestoneTree from "@/components/MilestoneTree";

export default function MilestonesPage() {
  return (
    <div className="p-6 space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Milestones</h1>
        <p className="text-xs text-gray-500 mt-1">
          Hierarchical Milestone → Goal → Sub-goal → Task tree with per-node
          feedback and attachments.
        </p>
      </div>
      <MilestoneTree />
    </div>
  );
}
