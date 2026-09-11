-- Breather Week columns + Q4 2026 seed.
-- Idempotent: safe to re-run.

-- 1) Add breather columns to quarters.
alter table public.quarters
  add column if not exists breather_start date,
  add column if not exists breather_end date;

-- 2) Backfill Q3 2026 breather (Sun Sep 27 → Sat Oct 3).
update public.quarters
   set breather_start = '2026-09-27',
       breather_end   = '2026-10-03'
 where name = 'Q3 2026';

-- 3) Insert Q4 2026 + 4 iterations × 3 weeks, only if it doesn't exist yet.
do $$
declare
  q_id uuid;
  it_id uuid;
  iter record;
  wk record;
begin
  if exists (select 1 from public.quarters where name = 'Q4 2026') then
    return;
  end if;

  insert into public.quarters (name, start_date, end_date, breather_start, breather_end)
       values ('Q4 2026', '2026-10-04', '2026-12-26', '2026-12-27', '2027-01-02')
    returning id into q_id;

  for iter in
    select * from (values
      (1, date '2026-10-04', date '2026-10-24'),
      (2, date '2026-10-25', date '2026-11-14'),
      (3, date '2026-11-15', date '2026-12-05'),
      (4, date '2026-12-06', date '2026-12-26')
    ) as t(n, s, e)
  loop
    insert into public.iterations (quarter_id, name, iteration_number, start_date, end_date)
         values (q_id, 'Iteration ' || iter.n, iter.n, iter.s, iter.e)
      returning id into it_id;

    for wk in
      select * from (values
        (1, iter.s,                      iter.s + 6),
        (2, iter.s + 7,                  iter.s + 13),
        (3, iter.s + 14,                 iter.s + 20)
      ) as w(n, s, e)
    loop
      insert into public.weeks (iteration_id, week_number, start_date, end_date)
           values (it_id, wk.n, wk.s, wk.e);
    end loop;
  end loop;
end $$;
