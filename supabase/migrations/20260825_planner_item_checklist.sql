-- Ops / infra support checklist on planner task cards.
--
-- Items are authored inside a card's drawer and surface in parallel in the
-- Feedback Trail's Ops Checklist tab, where they can be ticked off. Kept in
-- its own table rather than inside planner_boards.data so the trail can list
-- every item across the board in one query, and so ticking one off does not
-- rewrite the whole board document.
--
-- Keyed by the card's uuid inside planner_boards.data, which has no row of its
-- own — hence no foreign key on item_id.
--
-- No RLS, matching every other table here: access is enforced in the API
-- route handlers via getCallerRole.

create extension if not exists "pgcrypto";

create table if not exists public.planner_item_checklist (
  id          uuid primary key default gen_random_uuid(),
  board_id    text not null default 'default',
  item_id     text not null,
  label       text not null,
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     text,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  sort_order  int not null default 0
);

create index if not exists planner_checklist_item_idx
  on public.planner_item_checklist (item_id, sort_order, created_at);
-- The trail lists a whole board at once, newest activity first.
create index if not exists planner_checklist_board_idx
  on public.planner_item_checklist (board_id, created_at desc);

comment on table public.planner_item_checklist is
  'Ops/infra support items on a planner card. Mirrored into the Feedback Trail Ops Checklist tab; `done` drives the strike-through.';
