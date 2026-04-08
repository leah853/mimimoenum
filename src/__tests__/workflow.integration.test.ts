/**
 * Integration tests — full workflow against real Supabase.
 *
 * Flow tested:
 * 1. Create user
 * 2. Create quarter → iteration → week
 * 3. Create task (with owner + deadline)
 * 4. Add subtask
 * 5. Try to complete task (should FAIL — no deliverable)
 * 6. Upload deliverable
 * 7. Try to complete task (should FAIL — no feedback)
 * 8. Add feedback
 * 9. Complete task (should SUCCEED)
 * 10. Create dependency
 * 11. Verify dependency exists
 * 12. Cleanup
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xlipcwjlrguxwfimphnw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsaXBjd2pscmd1eHdmaW1waG53Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQxMjk2MiwiZXhwIjoyMDkwOTg4OTYyfQ.Fm4zLXihsSTJP3q3MZg7HKveA4QvOaM-mmPNPL0sYpI";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// Track IDs for cleanup
const cleanup: { table: string; id: string }[] = [];

async function cleanupAll() {
  for (const { table, id } of cleanup.reverse()) {
    await sb.from(table).delete().eq("id", id);
  }
}

describe("Full Workflow Integration", () => {
  let userId: string;
  let reviewerId: string;
  let quarterId: string;
  let iterationId: string;
  let weekId: string;
  let taskId: string;
  let task2Id: string;
  let subtaskId: string;
  let deliverableId: string;
  let feedbackId: string;
  let dependencyId: string;

  afterAll(async () => {
    await cleanupAll();
  });

  // STEP 1: Create users
  test("1. Create test users", async () => {
    const { data: user, error } = await sb.from("users").insert({
      email: `test-worker-${Date.now()}@test.com`,
      full_name: "Test Worker",
      role: "eonexea",
    }).select().single();

    expect(error).toBeNull();
    expect(user).toBeTruthy();
    userId = user!.id;
    cleanup.push({ table: "users", id: userId });

    const { data: reviewer } = await sb.from("users").insert({
      email: `test-reviewer-${Date.now()}@test.com`,
      full_name: "Test Reviewer",
      role: "mimimomentum",
    }).select().single();

    reviewerId = reviewer!.id;
    cleanup.push({ table: "users", id: reviewerId });
  });

  // STEP 2: Create hierarchy
  test("2. Create quarter", async () => {
    const { data, error } = await sb.from("quarters").insert({
      name: `Test Quarter ${Date.now()}`,
      start_date: "2026-04-06",
      end_date: "2026-07-04",
    }).select().single();

    expect(error).toBeNull();
    quarterId = data!.id;
    cleanup.push({ table: "quarters", id: quarterId });
  });

  test("2b. Create iteration", async () => {
    const { data, error } = await sb.from("iterations").insert({
      quarter_id: quarterId,
      name: "Test Iteration 1",
      iteration_number: 1,
      start_date: "2026-04-06",
      end_date: "2026-04-26",
    }).select().single();

    expect(error).toBeNull();
    iterationId = data!.id;
    cleanup.push({ table: "iterations", id: iterationId });
  });

  test("2c. Create week", async () => {
    const { data, error } = await sb.from("weeks").insert({
      iteration_id: iterationId,
      week_number: 1,
      start_date: "2026-04-06",
      end_date: "2026-04-12",
    }).select().single();

    expect(error).toBeNull();
    weekId = data!.id;
    cleanup.push({ table: "weeks", id: weekId });
  });

  // STEP 3: Create task
  test("3. Create task with owner and deadline", async () => {
    const { data, error } = await sb.from("tasks").insert({
      title: "Integration Test Task",
      owner_id: userId,
      deadline: "2026-04-26",
      quarter_id: quarterId,
      iteration_id: iterationId,
      category: "Test Category",
      status: "not_started",
    }).select().single();

    expect(error).toBeNull();
    expect(data!.owner_id).toBe(userId);
    expect(data!.deadline).toBe("2026-04-26");
    taskId = data!.id;
    cleanup.push({ table: "tasks", id: taskId });
  });

  // STEP 4: Add subtask
  test("4. Add subtask", async () => {
    const { data, error } = await sb.from("subtasks").insert({
      task_id: taskId,
      title: "Test Subtask",
      status: "not_started",
    }).select().single();

    expect(error).toBeNull();
    subtaskId = data!.id;
    cleanup.push({ table: "subtasks", id: subtaskId });
  });

  // STEP 5: Try to complete without deliverable — MUST FAIL
  test("5. FAIL: Complete task without deliverable", async () => {
    const { error } = await sb.from("tasks").update({ status: "completed" }).eq("id", taskId);

    expect(error).toBeTruthy();
    expect(error!.message).toContain("TASK_NO_DELIVERABLE");
  });

  // STEP 6: Upload deliverable
  test("6. Add deliverable", async () => {
    const { data, error } = await sb.from("deliverables").insert({
      task_id: taskId,
      title: "Test Document.pdf",
      file_url: "https://example.com/test.pdf",
      file_name: "test.pdf",
      version: 1,
      uploaded_by: userId,
    }).select().single();

    expect(error).toBeNull();
    deliverableId = data!.id;
    cleanup.push({ table: "deliverables", id: deliverableId });
  });

  // STEP 7: Try to complete without feedback — MUST FAIL
  test("7. FAIL: Complete task without feedback", async () => {
    const { error } = await sb.from("tasks").update({ status: "completed" }).eq("id", taskId);

    expect(error).toBeTruthy();
    expect(error!.message).toContain("TASK_NO_FEEDBACK");
  });

  // STEP 8: Add feedback
  test("8. Add feedback", async () => {
    const { data, error } = await sb.from("feedback").insert({
      task_id: taskId,
      reviewer_id: reviewerId,
      rating: 8,
      comment: "Good work",
      tag: "approved",
    }).select().single();

    expect(error).toBeNull();
    expect(data!.rating).toBe(8);
    feedbackId = data!.id;
    cleanup.push({ table: "feedback", id: feedbackId });
  });

  // STEP 9: Complete task — MUST SUCCEED
  test("9. SUCCESS: Complete task with deliverable + feedback", async () => {
    const { data, error } = await sb.from("tasks").update({ status: "completed" }).eq("id", taskId).select().single();

    expect(error).toBeNull();
    expect(data!.status).toBe("completed");
  });

  // STEP 10: Create second task and dependency
  test("10. Create dependency between tasks", async () => {
    const { data: t2 } = await sb.from("tasks").insert({
      title: "Dependent Task",
      owner_id: userId,
      deadline: "2026-05-10",
      quarter_id: quarterId,
      iteration_id: iterationId,
      status: "not_started",
    }).select().single();

    task2Id = t2!.id;
    cleanup.push({ table: "tasks", id: task2Id });

    const { data: dep, error } = await sb.from("dependencies").insert({
      task_id: task2Id,
      depends_on_task_id: taskId,
    }).select().single();

    expect(error).toBeNull();
    dependencyId = dep!.id;
    cleanup.push({ table: "dependencies", id: dependencyId });
  });

  // STEP 11: Verify dependency
  test("11. Verify dependency exists", async () => {
    const { data } = await sb.from("dependencies")
      .select("*")
      .eq("task_id", task2Id)
      .eq("depends_on_task_id", taskId);

    expect(data).toHaveLength(1);
  });

  // STEP 12: Self-dependency should fail
  test("12. FAIL: Self-dependency blocked", async () => {
    const { error } = await sb.from("dependencies").insert({
      task_id: taskId,
      depends_on_task_id: taskId,
    });

    expect(error).toBeTruthy();
  });

  // STEP 13: Task must have owner
  test("13. FAIL: Task without owner", async () => {
    const { error } = await sb.from("tasks").insert({
      title: "No Owner Task",
      deadline: "2026-04-26",
    });

    expect(error).toBeTruthy();
  });

  // STEP 14: Task must have deadline
  test("14. FAIL: Task without deadline", async () => {
    const { error } = await sb.from("tasks").insert({
      title: "No Deadline Task",
      owner_id: userId,
    });

    expect(error).toBeTruthy();
  });

  // STEP 15: Rating must be 1-10
  test("15. FAIL: Feedback with rating out of range", async () => {
    const { error } = await sb.from("feedback").insert({
      task_id: taskId,
      reviewer_id: reviewerId,
      rating: 11,
      tag: "approved",
    });

    expect(error).toBeTruthy();
  });
});
