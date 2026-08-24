-- Planner board: a standalone editable roadmap grid.
--
-- The planner is authored by hand rather than derived from tasks, so it needs
-- its own storage. The whole board (columns, rows, cells) is a single JSONB
-- document: the grid is edited and saved as a unit, and a row/column-per-record
-- schema would buy normalisation the UI never uses.
--
-- No RLS. This repo uses cookie-based auth and reaches Supabase exclusively
-- with the service-role key from API route handlers; access is enforced at the
-- API layer via getCallerRole. Matches every other table in this schema.

create extension if not exists "pgcrypto";

create table if not exists public.planner_boards (
  id          text primary key,
  data        jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create or replace function public.touch_planner_board_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists planner_boards_touch on public.planner_boards;
create trigger planner_boards_touch before update on public.planner_boards
  for each row execute function public.touch_planner_board_updated_at();

comment on table public.planner_boards is
  'Editable planner grids. One row per board; `data` holds quarters, iterations, weeks, rows and cell text.';
