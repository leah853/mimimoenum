import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/api-helpers";
import { getCallerRole } from "@/lib/api-auth";

/** Auto-create the quarter that follows the latest existing one, with 4
 *  iterations of 3 weeks each. Doer / admin only.
 *
 *  Name is derived: "Q2 2026" → "Q3 2026", "Q4 2026" → "Q1 2027".
 *  Start date = day after the latest quarter's end_date.
 *  Iterations run consecutively; weeks within an iteration are Monday-based
 *  when possible (we don't shift dates — we just partition the quarter's
 *  calendar into 4 × 3 = 12 weeks).
 */
function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextQuarterName(prevName: string): string {
  const m = prevName.match(/^Q(\d)\s*(\d{4})$/i);
  if (!m) return `Next quarter`;
  const q = parseInt(m[1], 10);
  const y = parseInt(m[2], 10);
  return q === 4 ? `Q1 ${y + 1}` : `Q${q + 1} ${y}`;
}

export async function POST(request: NextRequest) {
  const role = getCallerRole(request);
  if (!role) return err("Not authenticated", 401);
  if (role !== "admin" && role !== "doer") {
    return err("Only doers/admins can create quarters", 403);
  }

  const sb = createServiceClient();

  const { data: quarters, error: qErr } = await sb
    .from("quarters")
    .select("id, name, start_date, end_date")
    .order("start_date", { ascending: false });
  if (qErr) return err(qErr.message, 500);
  if (!quarters || quarters.length === 0) return err("No existing quarter to derive the next one from", 422);

  const latest = quarters[0];

  // Build the next quarter: same length as the latest, starting the day after
  // the latest ends. 4 iterations × 3 weeks each.
  const start = addDays(latest.end_date, 1);
  const newName = nextQuarterName(latest.name);
  const ITER_COUNT = 4;
  const WEEK_COUNT_PER_ITER = 3;
  const totalWeeks = ITER_COUNT * WEEK_COUNT_PER_ITER; // 12
  const end = addDays(start, totalWeeks * 7 - 1); // inclusive end

  // Check for accidental duplicate before writing.
  const dup = quarters.find((q: { name: string }) => q.name === newName);
  if (dup) return err(`Quarter "${newName}" already exists`, 409);

  const { data: quarter, error: insQErr } = await sb
    .from("quarters")
    .insert({ name: newName, start_date: start, end_date: end })
    .select()
    .single();
  if (insQErr) return err(insQErr.message, 500);

  // Iterations
  const iterationRows: { id?: string; iteration_number: number; start: string; end: string }[] = [];
  for (let i = 0; i < ITER_COUNT; i++) {
    const iStart = addDays(start, i * WEEK_COUNT_PER_ITER * 7);
    const iEnd = addDays(iStart, WEEK_COUNT_PER_ITER * 7 - 1);
    const { data, error } = await sb
      .from("iterations")
      .insert({
        quarter_id: quarter.id,
        name: `Iteration ${i + 1}`,
        iteration_number: i + 1,
        start_date: iStart,
        end_date: iEnd,
      })
      .select("id")
      .single();
    if (error) return err(`iter ${i + 1}: ${error.message}`, 500);
    iterationRows.push({ id: data.id, iteration_number: i + 1, start: iStart, end: iEnd });
  }

  // Weeks (3 per iteration)
  for (const it of iterationRows) {
    for (let w = 0; w < WEEK_COUNT_PER_ITER; w++) {
      const wStart = addDays(it.start, w * 7);
      const wEnd = addDays(wStart, 6);
      const { error } = await sb.from("weeks").insert({
        iteration_id: it.id,
        week_number: w + 1,
        start_date: wStart,
        end_date: wEnd,
      });
      if (error) return err(`week ${w + 1} of iter ${it.iteration_number}: ${error.message}`, 500);
    }
  }

  return ok({
    quarter: { id: quarter.id, name: newName, start_date: start, end_date: end },
    iterations_created: ITER_COUNT,
    weeks_created: ITER_COUNT * WEEK_COUNT_PER_ITER,
  }, 201);
}
