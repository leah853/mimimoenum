-- Breather iterations + Q1 2027 and Q2 2027 seed.
-- Idempotent: safe to re-run.
--
-- Purpose:
--   1. Add `is_breather` flag to iterations. Breather weeks are now real
--      iterations that can hold tasks — one week each, iteration_number = 99
--      so they sort to the end within their quarter.
--   2. Insert Q1 2027 and Q2 2027 (with proper Sun–Sat dates) if not present.
--   3. Backfill breather iterations for every quarter that already has
--      breather_start / breather_end (Q3 2026, Q4 2026, Q1 2027, Q2 2027).

-- 1) Flag column.
alter table public.iterations
  add column if not exists is_breather boolean not null default false;

-- 2) Widen iteration_number check so we can use 99 for breathers.
alter table public.iterations
  drop constraint if exists iterations_iteration_number_check;
alter table public.iterations
  add constraint iterations_iteration_number_check
  check (iteration_number between 1 and 99);

-- 3) Q1 2027 + iterations + weeks.
do $$
declare
  q_id uuid;
  it_id uuid;
  iter record;
  wk record;
begin
  if not exists (select 1 from public.quarters where name = 'Q1 2027') then
    insert into public.quarters (name, start_date, end_date, breather_start, breather_end)
         values ('Q1 2027', '2027-01-03', '2027-03-27', '2027-03-28', '2027-04-03')
      returning id into q_id;

    for iter in
      select * from (values
        (1, date '2027-01-03', date '2027-01-23'),
        (2, date '2027-01-24', date '2027-02-13'),
        (3, date '2027-02-14', date '2027-03-06'),
        (4, date '2027-03-07', date '2027-03-27')
      ) as t(n, s, e)
    loop
      insert into public.iterations (quarter_id, name, iteration_number, start_date, end_date)
           values (q_id, 'Iteration ' || iter.n, iter.n, iter.s, iter.e)
        returning id into it_id;
      for wk in
        select * from (values
          (1, iter.s,     iter.s + 6),
          (2, iter.s + 7, iter.s + 13),
          (3, iter.s + 14, iter.s + 20)
        ) as w(n, s, e)
      loop
        insert into public.weeks (iteration_id, week_number, start_date, end_date)
             values (it_id, wk.n, wk.s, wk.e);
      end loop;
    end loop;
  end if;
end $$;

-- 4) Q2 2027 + iterations + weeks.
do $$
declare
  q_id uuid;
  it_id uuid;
  iter record;
  wk record;
begin
  if not exists (select 1 from public.quarters where name = 'Q2 2027') then
    insert into public.quarters (name, start_date, end_date, breather_start, breather_end)
         values ('Q2 2027', '2027-04-04', '2027-06-26', '2027-06-27', '2027-07-03')
      returning id into q_id;

    for iter in
      select * from (values
        (1, date '2027-04-04', date '2027-04-24'),
        (2, date '2027-04-25', date '2027-05-15'),
        (3, date '2027-05-16', date '2027-06-05'),
        (4, date '2027-06-06', date '2027-06-26')
      ) as t(n, s, e)
    loop
      insert into public.iterations (quarter_id, name, iteration_number, start_date, end_date)
           values (q_id, 'Iteration ' || iter.n, iter.n, iter.s, iter.e)
        returning id into it_id;
      for wk in
        select * from (values
          (1, iter.s,     iter.s + 6),
          (2, iter.s + 7, iter.s + 13),
          (3, iter.s + 14, iter.s + 20)
        ) as w(n, s, e)
      loop
        insert into public.weeks (iteration_id, week_number, start_date, end_date)
             values (it_id, wk.n, wk.s, wk.e);
      end loop;
    end loop;
  end if;
end $$;

-- 5) Breather iterations for every quarter that has breather_start/end but
--    no breather iteration yet. One iteration, one week, iteration_number=99.
do $$
declare
  q record;
  it_id uuid;
begin
  for q in
    select id, name, breather_start, breather_end
      from public.quarters
     where breather_start is not null
       and breather_end   is not null
       and not exists (
         select 1 from public.iterations i
          where i.quarter_id = quarters.id and i.is_breather = true
       )
  loop
    insert into public.iterations
      (quarter_id, name, iteration_number, start_date, end_date, is_breather)
      values (q.id, 'Breather', 99, q.breather_start, q.breather_end, true)
      returning id into it_id;

    insert into public.weeks (iteration_id, week_number, start_date, end_date)
      values (it_id, 1, q.breather_start, q.breather_end);
  end loop;
end $$;
