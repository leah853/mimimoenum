-- Milestone tree: hierarchical Milestone -> Goal -> Sub-goal -> Task nodes
-- with per-node feedback and file attachments (private bucket).
--
-- No RLS. This repo uses cookie-based auth and calls Supabase exclusively
-- with the service-role key from API route handlers. Access is enforced at
-- the API layer via getCallerRole/getCallerId. Matches the pattern of every
-- other table in this schema.

create extension if not exists "pgcrypto";

create table if not exists public.milestone_nodes (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references public.milestone_nodes(id) on delete cascade,
  owner_id     uuid not null references public.users(id),
  title        text not null,
  kind         text not null check (kind in ('Milestone','Goal','Sub-goal','Task')),
  assignee     text,
  score        int check (score between 1 and 10),
  sort_order   int not null default 0,
  collapsed    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists milestone_nodes_parent_idx on public.milestone_nodes(parent_id);
create index if not exists milestone_nodes_owner_idx  on public.milestone_nodes(owner_id);

create table if not exists public.milestone_node_feedback (
  id         uuid primary key default gen_random_uuid(),
  node_id    uuid not null references public.milestone_nodes(id) on delete cascade,
  owner_id   uuid not null references public.users(id),
  author     text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists milestone_feedback_node_idx on public.milestone_node_feedback(node_id);

create table if not exists public.milestone_node_attachments (
  id            uuid primary key default gen_random_uuid(),
  node_id       uuid not null references public.milestone_nodes(id) on delete cascade,
  owner_id      uuid not null references public.users(id),
  storage_path  text not null,
  filename      text not null,
  content_type  text,
  size_bytes    bigint,
  uploaded_by   text not null,
  uploaded_at   timestamptz not null default now()
);
create index if not exists milestone_attachments_node_idx on public.milestone_node_attachments(node_id);

create or replace function public.touch_milestone_node_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists milestone_nodes_touch on public.milestone_nodes;
create trigger milestone_nodes_touch before update on public.milestone_nodes
  for each row execute function public.touch_milestone_node_updated_at();

-- Private bucket for milestone attachments. Distinct from the existing public
-- 'deliverables' bucket used by tasks.
insert into storage.buckets (id, name, public)
values ('milestone_attachments', 'milestone_attachments', false)
on conflict (id) do update set public = false;
