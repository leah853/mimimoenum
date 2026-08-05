// Auto-assigns a task's week_id from its iteration + deadline. Every task in
// an iteration must live inside one of that iteration's weeks — iteration-level
// (week_id = null) tasks are no longer allowed. Rules:
//   • deadline inside a week's [start_date, end_date] → that week
//   • deadline before the first week → clamp to first week
//   • deadline after the last week   → clamp to last week
//   • deadline missing               → first week
// Returns null only if the iteration has zero weeks (caller decides what to do).

type WeekRow = { id: string; week_number: number; start_date: string; end_date: string };

// `sb` is typed loosely because callers pass different Supabase client flavors
// (service client from `createServiceClient`, generic `SupabaseClient` in the
// CSV importer). Both expose the same fluent select/eq/order surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveWeekId(
  sb: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  iterationId: string,
  deadline?: string | null,
): Promise<string | null> {
  const { data } = await sb
    .from("weeks")
    .select("id, week_number, start_date, end_date")
    .eq("iteration_id", iterationId)
    .order("week_number", { ascending: true });
  const weeks: WeekRow[] = data || [];
  if (weeks.length === 0) return null;
  if (!deadline) return weeks[0].id;
  const hit = weeks.find((w) => w.start_date <= deadline && deadline <= w.end_date);
  if (hit) return hit.id;
  if (deadline < weeks[0].start_date) return weeks[0].id;
  return weeks[weeks.length - 1].id; // deadline > last week's end_date
}
