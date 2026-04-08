import { checkTaskCompletion, getCompletionBlockers } from "@/lib/business-rules";
import type { Task, Deliverable, Feedback } from "@/lib/types";

const baseTask: Task = {
  id: "t1",
  title: "Test Task",
  status: "in_progress",
  progress: 0,
  created_at: "2026-04-06",
  updated_at: "2026-04-06",
};

describe("Business Rules — Task Completion", () => {
  test("cannot complete without deliverable", () => {
    const result = checkTaskCompletion(baseTask, [], [{ id: "f1" } as Feedback]);
    expect(result.canComplete).toBe(false);
    expect(result.reasons).toContain("At least one deliverable is required before completion");
  });

  test("cannot complete without feedback", () => {
    const result = checkTaskCompletion(baseTask, [{ id: "d1" } as Deliverable], []);
    expect(result.canComplete).toBe(false);
    expect(result.reasons).toContain("Feedback is required before completion");
  });

  test("cannot complete without both deliverable and feedback", () => {
    const result = checkTaskCompletion(baseTask, [], []);
    expect(result.canComplete).toBe(false);
    expect(result.reasons).toHaveLength(2);
  });

  test("can complete with deliverable and feedback", () => {
    const result = checkTaskCompletion(
      baseTask,
      [{ id: "d1" } as Deliverable],
      [{ id: "f1" } as Feedback]
    );
    expect(result.canComplete).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });
});

describe("getCompletionBlockers", () => {
  test("returns both blockers when nothing attached", () => {
    const task = { ...baseTask, deliverables: [], feedback: [] };
    const blockers = getCompletionBlockers(task);
    expect(blockers).toHaveLength(2);
    expect(blockers).toContain("No deliverable uploaded");
    expect(blockers).toContain("No feedback received");
  });

  test("returns no blockers when both attached", () => {
    const task = { ...baseTask, deliverables: [{ id: "d1" }], feedback: [{ id: "f1" }] };
    const blockers = getCompletionBlockers(task);
    expect(blockers).toHaveLength(0);
  });

  test("returns only deliverable blocker when feedback exists", () => {
    const task = { ...baseTask, deliverables: [], feedback: [{ id: "f1" }] };
    const blockers = getCompletionBlockers(task);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toBe("No deliverable uploaded");
  });

  test("returns only feedback blocker when deliverable exists", () => {
    const task = { ...baseTask, deliverables: [{ id: "d1" }], feedback: [] };
    const blockers = getCompletionBlockers(task);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toBe("No feedback received");
  });
});
