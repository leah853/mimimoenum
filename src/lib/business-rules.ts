import type { Task } from "@/lib/types";

export function getCompletionBlockers(task: Task & { deliverables?: { id: string }[]; feedback?: { id: string }[] }): string[] {
  const blockers: string[] = [];
  if (!task.deliverables?.length) blockers.push("No deliverable uploaded");
  if (!task.feedback?.length) blockers.push("No feedback received");
  return blockers;
}
