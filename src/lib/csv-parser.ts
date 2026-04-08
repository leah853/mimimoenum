import { SupabaseClient } from "@supabase/supabase-js";

export interface ParseLog {
  type: "info" | "warning" | "error";
  message: string;
}

export interface ParseResult {
  success: boolean;
  stats: {
    quarters: number;
    iterations: number;
    weeks: number;
    tasks: number;
    subtasks: number;
    users: number;
    dependencies: number;
  };
  logs: ParseLog[];
}

interface RawRow {
  quarter?: string;
  iteration?: string;
  week?: string;
  task_name?: string;
  subtask_name?: string;
  owner_email?: string;
  deadline?: string;
  dependencies?: string;
  category?: string;
  description?: string;
}

function normalize(row: Record<string, string>): RawRow {
  const n: Record<string, string> = {};
  for (const [key, val] of Object.entries(row)) {
    n[key.toLowerCase().trim().replace(/\s+/g, "_")] = String(val || "").trim();
  }
  return {
    quarter: n.quarter || "",
    iteration: n.iteration || n.iteration_period || n.iteration_number || "",
    week: n.week || n.week_number || "",
    task_name: n.task_name || n.task || n.goal || "",
    subtask_name: n.subtask_name || n.subtask || "",
    owner_email: n.owner_email || n.owner || n.email || "",
    deadline: n.deadline || n.due_date || n.due || "",
    dependencies: n.dependencies || n.dependency || n.depends_on || "",
    category: n.category || "",
    description: n.description || "",
  };
}

export async function parseAndIngest(
  supabase: SupabaseClient,
  rows: Record<string, string>[]
): Promise<ParseResult> {
  const logs: ParseLog[] = [];
  const stats = { quarters: 0, iterations: 0, weeks: 0, tasks: 0, subtasks: 0, users: 0, dependencies: 0 };

  // Normalize rows
  const normalized = rows.map(normalize);

  // Deduplicate
  const seen = new Set<string>();
  const unique: RawRow[] = [];
  for (const row of normalized) {
    const key = `${row.quarter}|${row.iteration}|${row.week}|${row.task_name}|${row.subtask_name}`;
    if (seen.has(key)) {
      logs.push({ type: "warning", message: `Duplicate row skipped: ${row.task_name}` });
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  // Maps for ID resolution
  const quarterMap = new Map<string, string>();
  const iterationMap = new Map<string, string>();
  const weekMap = new Map<string, string>();
  const userMap = new Map<string, string>();
  const taskMap = new Map<string, string>(); // task_name -> task_id

  // ============================================
  // PHASE 1: Create hierarchy (Quarter → Iteration → Week)
  // ============================================

  // Quarters
  for (const row of unique) {
    if (!row.quarter || quarterMap.has(row.quarter)) continue;

    // Parse dates from quarter name or use defaults
    let startDate = "2026-04-06";
    let endDate = "2026-07-04";
    if (row.quarter.toLowerCase().includes("q1")) { startDate = "2026-01-06"; endDate = "2026-04-05"; }
    if (row.quarter.toLowerCase().includes("q3")) { startDate = "2026-07-06"; endDate = "2026-10-04"; }
    if (row.quarter.toLowerCase().includes("q4")) { startDate = "2026-10-06"; endDate = "2027-01-04"; }

    const { data, error } = await supabase
      .from("quarters")
      .upsert({ name: row.quarter, start_date: startDate, end_date: endDate }, { onConflict: "name" })
      .select("id")
      .single();

    if (data) {
      quarterMap.set(row.quarter, data.id);
      stats.quarters++;
      logs.push({ type: "info", message: `Quarter: ${row.quarter}` });
    } else if (error) {
      // Try fetching existing
      const { data: existing } = await supabase.from("quarters").select("id").eq("name", row.quarter).single();
      if (existing) quarterMap.set(row.quarter, existing.id);
      else logs.push({ type: "error", message: `Failed to create quarter: ${row.quarter} — ${error.message}` });
    }
  }

  // Iterations
  for (const row of unique) {
    if (!row.iteration || !row.quarter) continue;
    const iterKey = `${row.quarter}|${row.iteration}`;
    if (iterationMap.has(iterKey)) continue;

    const quarterId = quarterMap.get(row.quarter);
    if (!quarterId) {
      logs.push({ type: "error", message: `No quarter found for iteration: ${row.iteration}` });
      continue;
    }

    const iterNum = parseInt(row.iteration.replace(/\D/g, "")) || 1;
    const iterName = row.iteration.match(/^[0-9]+$/) ? `Iteration ${iterNum}` : row.iteration;

    // Calculate dates based on iteration number
    const qStart = new Date("2026-04-06");
    const iterStart = new Date(qStart);
    iterStart.setDate(iterStart.getDate() + (iterNum - 1) * 21);
    const iterEnd = new Date(iterStart);
    iterEnd.setDate(iterEnd.getDate() + 20);

    const { data, error } = await supabase.from("iterations").upsert({
      quarter_id: quarterId,
      name: iterName,
      iteration_number: Math.min(iterNum, 12),
      start_date: iterStart.toISOString().split("T")[0],
      end_date: iterEnd.toISOString().split("T")[0],
    }, { onConflict: "quarter_id,iteration_number" }).select("id").single();

    if (data) {
      iterationMap.set(iterKey, data.id);
      stats.iterations++;
      logs.push({ type: "info", message: `Iteration: ${iterName}` });
    } else if (error) {
      const { data: existing } = await supabase.from("iterations")
        .select("id").eq("quarter_id", quarterId).eq("iteration_number", Math.min(iterNum, 12)).single();
      if (existing) iterationMap.set(iterKey, existing.id);
      else logs.push({ type: "error", message: `Failed to create iteration: ${error.message}` });
    }
  }

  // Weeks
  for (const row of unique) {
    if (!row.week || !row.iteration || !row.quarter) continue;
    const weekKey = `${row.quarter}|${row.iteration}|${row.week}`;
    if (weekMap.has(weekKey)) continue;

    const iterKey = `${row.quarter}|${row.iteration}`;
    const iterationId = iterationMap.get(iterKey);
    if (!iterationId) continue;

    const weekNum = parseInt(row.week.replace(/\D/g, "")) || 1;

    // Get iteration dates to compute week dates
    const { data: iter } = await supabase.from("iterations").select("start_date").eq("id", iterationId).single();
    const iterStart = iter ? new Date(iter.start_date) : new Date("2026-04-06");
    const weekStart = new Date(iterStart);
    weekStart.setDate(weekStart.getDate() + (weekNum - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const { data, error } = await supabase.from("weeks").upsert({
      iteration_id: iterationId,
      week_number: Math.min(weekNum, 5),
      start_date: weekStart.toISOString().split("T")[0],
      end_date: weekEnd.toISOString().split("T")[0],
    }, { onConflict: "iteration_id,week_number" }).select("id").single();

    if (data) {
      weekMap.set(weekKey, data.id);
      stats.weeks++;
    } else if (error) {
      const { data: existing } = await supabase.from("weeks")
        .select("id").eq("iteration_id", iterationId).eq("week_number", Math.min(weekNum, 5)).single();
      if (existing) weekMap.set(weekKey, existing.id);
    }
  }

  // ============================================
  // PHASE 2: Resolve / create users
  // ============================================
  for (const row of unique) {
    if (!row.owner_email || userMap.has(row.owner_email)) continue;

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", row.owner_email)
      .single();

    if (existing) {
      userMap.set(row.owner_email, existing.id);
    } else {
      // Create user
      const { data: newUser, error } = await supabase.from("users").insert({
        email: row.owner_email,
        full_name: row.owner_email.split("@")[0],
        role: "eonexea",
      }).select("id").single();

      if (newUser) {
        userMap.set(row.owner_email, newUser.id);
        stats.users++;
        logs.push({ type: "info", message: `User created: ${row.owner_email}` });
      } else {
        logs.push({ type: "error", message: `Failed to create user ${row.owner_email}: ${error?.message}` });
      }
    }
  }

  // ============================================
  // PHASE 3: Create tasks
  // ============================================
  for (const row of unique) {
    if (!row.task_name || taskMap.has(row.task_name)) continue;

    const ownerId = row.owner_email ? userMap.get(row.owner_email) : null;
    if (!ownerId) {
      logs.push({ type: "error", message: `Missing owner for task: ${row.task_name}. Skipping.` });
      continue;
    }

    const quarterId = quarterMap.get(row.quarter || "");
    const iterKey = `${row.quarter}|${row.iteration}`;
    const weekKey = `${row.quarter}|${row.iteration}|${row.week}`;

    let deadline = row.deadline || null;
    if (!deadline) {
      // Default deadline to iteration end date
      const iterId = iterationMap.get(iterKey);
      if (iterId) {
        const { data: iter } = await supabase.from("iterations").select("end_date").eq("id", iterId).single();
        deadline = iter?.end_date || "2026-07-04";
      } else {
        deadline = "2026-07-04";
      }
    }

    const { data, error } = await supabase.from("tasks").insert({
      title: row.task_name,
      description: row.description || null,
      category: row.category || null,
      owner_id: ownerId,
      deadline,
      quarter_id: quarterId || null,
      iteration_id: iterationMap.get(iterKey) || null,
      week_id: weekMap.get(weekKey) || null,
      status: "not_started",
      start_date: deadline, // default
      end_date: deadline,
    }).select("id").single();

    if (data) {
      taskMap.set(row.task_name, data.id);
      stats.tasks++;
      logs.push({ type: "info", message: `Task: ${row.task_name}` });
    } else {
      logs.push({ type: "error", message: `Failed to create task "${row.task_name}": ${error?.message}` });
    }
  }

  // ============================================
  // PHASE 4: Create subtasks
  // ============================================
  for (const row of unique) {
    if (!row.subtask_name || !row.task_name) continue;
    const taskId = taskMap.get(row.task_name);
    if (!taskId) {
      logs.push({ type: "warning", message: `Parent task not found for subtask: ${row.subtask_name}` });
      continue;
    }

    const ownerId = row.owner_email ? userMap.get(row.owner_email) : null;

    const { error } = await supabase.from("subtasks").insert({
      task_id: taskId,
      title: row.subtask_name,
      owner_id: ownerId || null,
      deadline: row.deadline || null,
      status: "not_started",
    });

    if (!error) {
      stats.subtasks++;
      logs.push({ type: "info", message: `Subtask: ${row.subtask_name}` });
    }
  }

  // ============================================
  // PHASE 5: Resolve dependencies AFTER all tasks created
  // ============================================
  for (const row of unique) {
    if (!row.dependencies || !row.task_name) continue;
    const taskId = taskMap.get(row.task_name);
    if (!taskId) continue;

    const deps = row.dependencies.split(",").map((d) => d.trim()).filter(Boolean);
    for (const depName of deps) {
      const depId = taskMap.get(depName);
      if (depId) {
        const { error } = await supabase.from("dependencies").insert({
          task_id: taskId,
          depends_on_task_id: depId,
        });
        if (!error) {
          stats.dependencies++;
          logs.push({ type: "info", message: `Dependency: ${row.task_name} → ${depName}` });
        }
      } else {
        logs.push({ type: "warning", message: `Invalid dependency skipped: "${depName}" for task "${row.task_name}"` });
      }
    }
  }

  return { success: true, stats, logs };
}
