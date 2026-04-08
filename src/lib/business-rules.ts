import type { Task, Deliverable, Feedback } from "@/lib/types";

export interface CompletionCheck {
  canComplete: boolean;
  reasons: string[];
}

export function checkTaskCompletion(
  task: Task,
  deliverables: (Deliverable | { id: string })[],
  feedback: (Feedback | { id: string })[]
): CompletionCheck {
  const reasons: string[] = [];

  if (!deliverables || deliverables.length === 0) {
    reasons.push("At least one deliverable is required before completion");
  }

  if (!feedback || feedback.length === 0) {
    reasons.push("Feedback is required before completion");
  }

  return {
    canComplete: reasons.length === 0,
    reasons,
  };
}

export function getCompletionBlockers(task: Task & { deliverables?: { id: string }[]; feedback?: { id: string }[] }): string[] {
  const blockers: string[] = [];
  if (!task.deliverables?.length) blockers.push("No deliverable uploaded");
  if (!task.feedback?.length) blockers.push("No feedback received");
  return blockers;
}
