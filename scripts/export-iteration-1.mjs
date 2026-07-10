import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const OUT = process.argv[2] || "./iteration-1-export";
mkdirSync(OUT, { recursive: true });

// Find Iteration 1
const { data: iters, error: iErr } = await sb
  .from("iterations")
  .select("id, name, iteration_number, start_date, end_date, quarter_id")
  .order("iteration_number", { ascending: true });
if (iErr) { console.error(iErr); process.exit(1); }

const iter1 = iters.find((i) => i.iteration_number === 1);
if (!iter1) {
  console.error("No iteration with iteration_number = 1 found. Available:");
  iters.forEach((i) => console.error(`  #${i.iteration_number} ${i.name} (${i.id})`));
  process.exit(1);
}

console.log(`Iteration 1: ${iter1.name} (${iter1.id})`);
console.log(`  Window: ${iter1.start_date} → ${iter1.end_date}`);

// Fetch all tasks in iteration 1 with everything hanging off them
const { data: tasks, error: tErr } = await sb
  .from("tasks")
  .select(`
    *,
    owner:users!tasks_owner_id_fkey(id, full_name, email),
    subtasks(*, owner:users!subtasks_owner_id_fkey(id, full_name)),
    deliverables(id, title, file_url, file_name, version, created_at, description),
    feedback(*, reviewer:users!feedback_reviewer_id_fkey(id, full_name))
  `)
  .eq("iteration_id", iter1.id)
  .order("category", { ascending: true })
  .order("created_at", { ascending: true });

if (tErr) { console.error(tErr); process.exit(1); }

console.log(`\nFound ${tasks.length} tasks in Iteration 1.`);

// --- Write master JSON ---
writeFileSync(`${OUT}/iteration-1.json`, JSON.stringify({ iteration: iter1, tasks }, null, 2));
console.log(`  → wrote ${OUT}/iteration-1.json`);

// --- Write a CSV summary ---
const csvHeader = [
  "id", "title", "category", "owner", "status", "deadline",
  "subtasks", "deliverables", "feedback_count", "avg_score", "latest_tag",
];
const csvLines = [csvHeader.join(",")];
for (const t of tasks) {
  const avgScore = (t.feedback && t.feedback.length)
    ? (t.feedback.reduce((s, f) => s + (f.rating || 0), 0) / t.feedback.length).toFixed(1)
    : "";
  const latestTag = (t.feedback && t.feedback.length)
    ? [...t.feedback].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0].tag
    : "";
  const row = [
    t.id,
    JSON.stringify(t.title || ""),
    JSON.stringify(t.category || ""),
    JSON.stringify(t.owner?.full_name || ""),
    t.status,
    t.deadline || "",
    (t.subtasks || []).length,
    (t.deliverables || []).length,
    (t.feedback || []).length,
    avgScore,
    latestTag,
  ];
  csvLines.push(row.join(","));
}
writeFileSync(`${OUT}/iteration-1-summary.csv`, csvLines.join("\n"));
console.log(`  → wrote ${OUT}/iteration-1-summary.csv`);

// --- One markdown file per task for human readability ---
mkdirSync(`${OUT}/tasks`, { recursive: true });
for (const t of tasks) {
  const safeTitle = (t.title || "untitled").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 60);
  const filename = `${OUT}/tasks/${t.category?.replace(/[^a-zA-Z0-9._-]/g, "-") || "uncategorized"}__${safeTitle}__${t.id.slice(0, 8)}.md`;
  const lines = [
    `# ${t.title || "(untitled)"}`,
    ``,
    `- **ID**: ${t.id}`,
    `- **Category**: ${t.category || "—"}`,
    `- **Owner**: ${t.owner?.full_name || "—"} (${t.owner?.email || "—"})`,
    `- **Status**: ${t.status}`,
    `- **Deadline**: ${t.deadline || "—"}`,
    `- **Iteration**: ${iter1.name}`,
    ``,
  ];
  if (t.description) {
    lines.push(`## Description`, ``, t.description, ``);
  }
  if (t.subtasks && t.subtasks.length) {
    lines.push(`## Subtasks (${t.subtasks.length})`, ``);
    for (const s of t.subtasks) {
      lines.push(`- **${s.title}** — ${s.status}${s.owner?.full_name ? ` · ${s.owner.full_name}` : ""}`);
    }
    lines.push(``);
  }
  if (t.deliverables && t.deliverables.length) {
    lines.push(`## Deliverables (${t.deliverables.length})`, ``);
    for (const d of t.deliverables) {
      lines.push(`- **${d.title || d.file_name || "(untitled)"}** — v${d.version || 1}`);
      if (d.description) lines.push(`  - ${d.description}`);
      if (d.file_url) lines.push(`  - <${d.file_url}>`);
      lines.push(`  - uploaded ${new Date(d.created_at).toLocaleString()}`);
    }
    lines.push(``);
  }
  if (t.feedback && t.feedback.length) {
    lines.push(`## Feedback (${t.feedback.length})`, ``);
    const sorted = [...t.feedback].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    for (const f of sorted) {
      lines.push(`- **${f.reviewer?.full_name || "Unknown"}** · ${f.rating}/10 · \`${f.tag}\` · ${new Date(f.created_at).toLocaleDateString()}`);
      if (f.comment) lines.push(`  > ${f.comment.replace(/\n/g, "\n  > ")}`);
    }
    lines.push(``);
  }
  writeFileSync(filename, lines.join("\n"));
}
console.log(`  → wrote ${tasks.length} markdown files under ${OUT}/tasks/`);

// --- Grouped-by-category summary at the root ---
const byCat = {};
for (const t of tasks) {
  const k = t.category || "Uncategorized";
  (byCat[k] = byCat[k] || []).push(t);
}
const readmeLines = [
  `# Iteration 1 export — ${iter1.name}`,
  ``,
  `Window: ${iter1.start_date} → ${iter1.end_date}  \nTotal tasks: **${tasks.length}**`,
  ``,
];
for (const [cat, list] of Object.entries(byCat).sort()) {
  readmeLines.push(`## ${cat} (${list.length})`, ``);
  for (const t of list) {
    const flags = [];
    if ((t.deliverables || []).length) flags.push(`📎 ${t.deliverables.length}`);
    if ((t.feedback || []).length) flags.push(`💬 ${t.feedback.length}`);
    const flagStr = flags.length ? ` — ${flags.join(" · ")}` : "";
    readmeLines.push(`- **${t.title}** · ${t.status} · owner: ${t.owner?.full_name || "—"}${flagStr}`);
  }
  readmeLines.push(``);
}
writeFileSync(`${OUT}/README.md`, readmeLines.join("\n"));
console.log(`  → wrote ${OUT}/README.md`);

console.log(`\n✅ Done. Exported to: ${OUT}/`);
