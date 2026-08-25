-- Version history for planner boards.
--
-- A board is stored as a single JSONB document that every save replaces
-- wholesale, so one bad write destroys everything before it. Keep the previous
-- state on each save: recovery becomes a row copy rather than a database
-- restore, and it covers the cases a nightly backup cannot (anything written
-- since the last snapshot).
--
-- No RLS, matching every other table here: access is enforced in the API
-- route handlers via getCallerRole.

create table if not exists public.planner_board_versions (
  id         bigserial primary key,
  board_id   text not null,
  data       jsonb not null,
  saved_by   text,
  saved_at   timestamptz not null default now()
);

-- Lookups are always "latest N for this board".
create index if not exists planner_board_versions_board_idx
  on public.planner_board_versions (board_id, saved_at desc);

comment on table public.planner_board_versions is
  'Prior states of planner_boards.data, newest first. Written by PUT /api/planner before each overwrite; pruned to the most recent 30 per board.';
