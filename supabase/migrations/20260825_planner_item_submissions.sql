-- Deliverables and feedback for planner task cards.
--
-- Mirrors the milestone-tree module (milestone_node_attachments /
-- milestone_node_feedback) so the two behave identically. The difference is
-- the parent: planner cards live inside planner_boards.data as JSONB, so they
-- have no row to reference. Rows are keyed by the card's uuid plus the board
-- it belongs to, and there is no foreign key to enforce that link.
--
-- No RLS, matching every other table here: access is enforced in the API
-- route handlers via getCallerRole.

create extension if not exists "pgcrypto";

create table if not exists public.planner_item_attachments (
  id            uuid primary key default gen_random_uuid(),
  board_id      text not null default 'default',
  item_id       text not null,
  owner_id      uuid not null references public.users(id),
  kind          text not null default 'file' check (kind in ('file','link','text')),
  storage_path  text,
  filename      text not null,
  link_url      text,
  text_body     text,
  content_type  text,
  size_bytes    bigint,
  uploaded_by   text not null,
  uploaded_at   timestamptz not null default now(),
  reviewed      boolean not null default false,
  reviewed_at   timestamptz,
  reviewed_by   uuid references public.users(id),
  -- Files live in storage; links and text notes never touch it.
  constraint planner_submission_payload_check check (
    (kind = 'file' and storage_path is not null) or
    (kind = 'link' and link_url is not null) or
    (kind = 'text' and text_body is not null)
  )
);
create index if not exists planner_attachments_item_idx
  on public.planner_item_attachments (item_id, uploaded_at desc);

create table if not exists public.planner_item_feedback (
  id         uuid primary key default gen_random_uuid(),
  board_id   text not null default 'default',
  item_id    text not null,
  owner_id   uuid not null references public.users(id),
  author     text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists planner_feedback_item_idx
  on public.planner_item_feedback (item_id, created_at);

-- Private bucket, separate from the public 'deliverables' bucket used by tasks
-- and from milestone_attachments.
insert into storage.buckets (id, name, public)
values ('planner_attachments', 'planner_attachments', false)
on conflict (id) do update set public = false;

comment on table public.planner_item_attachments is
  'Deliverables attached to a planner card (planner_boards.data item uuid). Kinds: file, link, text.';
comment on table public.planner_item_feedback is
  'Comment thread on a planner card, keyed by the card uuid inside planner_boards.data.';
