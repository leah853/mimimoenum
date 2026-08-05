-- Backfill: every task must live inside a week of its iteration. Historically
-- some tasks were created with week_id = NULL (iteration-level "goals").
-- We assign each such task to a week using the same date-range logic the API
-- helper `resolveWeekId` uses:
--   • deadline inside a week's [start_date, end_date] → that week
--   • deadline missing OR before the first week's start → first week
--   • deadline after the last week's end → last week
--
-- Idempotent: only touches tasks where week_id IS NULL AND iteration_id IS NOT NULL.
-- After backfill, week_id is made NOT NULL to enforce the invariant going forward.

begin;

with weeks_ordered as (
  select
    w.iteration_id,
    w.id as week_id,
    w.week_number,
    w.start_date,
    w.end_date,
    min(w.week_number) over (partition by w.iteration_id) as first_wn,
    max(w.week_number) over (partition by w.iteration_id) as last_wn
  from public.weeks w
),
resolved as (
  select
    t.id as task_id,
    coalesce(
      -- 1. deadline lands inside a week
      (select w.week_id
         from weeks_ordered w
        where w.iteration_id = t.iteration_id
          and t.deadline is not null
          and t.deadline between w.start_date and w.end_date
        limit 1),
      -- 2. deadline after last week → last week
      (select w.week_id
         from weeks_ordered w
        where w.iteration_id = t.iteration_id
          and t.deadline is not null
          and w.week_number = w.last_wn
          and t.deadline > w.end_date
        limit 1),
      -- 3. everything else (null deadline, before first week) → first week
      (select w.week_id
         from weeks_ordered w
        where w.iteration_id = t.iteration_id
          and w.week_number = w.first_wn
        limit 1)
    ) as new_week_id
  from public.tasks t
  where t.week_id is null
    and t.iteration_id is not null
)
update public.tasks t
   set week_id = r.new_week_id
  from resolved r
 where t.id = r.task_id
   and r.new_week_id is not null;

-- Enforce the invariant. If any task still has week_id IS NULL at this point
-- it means its iteration has zero weeks (or no iteration at all) — that's a
-- data problem to fix by hand; the ALTER will raise and roll back the txn.
alter table public.tasks alter column week_id set not null;

commit;
