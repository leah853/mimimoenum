-- Campaign Checklist: line → section → item → channel taxonomy with versioned
-- submissions per leaf. Multiple attachments per submission. Reps decide
-- GO / NO-GO; a leaf is locked once its latest submission is GO.

create extension if not exists "pgcrypto";

create table if not exists public.campaign_nodes (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.campaign_nodes(id) on delete cascade,
  kind text not null check (kind in ('line','section','item','channel')),
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists campaign_nodes_parent_idx on public.campaign_nodes(parent_id);

create table if not exists public.campaign_submissions (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.campaign_nodes(id) on delete cascade,
  version_number int not null,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now(),
  decision text check (decision in ('go','no_go')),
  decided_by text,
  decided_at timestamptz,
  feedback text,
  unique (node_id, version_number)
);
create index if not exists campaign_submissions_node_idx on public.campaign_submissions(node_id);

create table if not exists public.campaign_submission_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.campaign_submissions(id) on delete cascade,
  kind text not null check (kind in ('file','link','text')),
  file_url text,
  file_name text,
  link_url text,
  text_body text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index if not exists campaign_submission_attachments_sub_idx on public.campaign_submission_attachments(submission_id);

-- ─── Seed taxonomy (only if empty) ───────────────────────────────────────
do $$
declare
  florida uuid;
  sebring uuid;
  s_brand uuid; s_core uuid; s_ops uuid; s_msg uuid;
  item_parent uuid;
  channels text[] := array['Email','Phone','LinkedIn Page','X Page','FB Page','Insta Page','Doximity Page'];
  msg_channels text[] := array['Emails','LinkedIn','Personalised brochure for snail mail'];
  ch text;
  idx int;
begin
  if exists (select 1 from public.campaign_nodes) then
    return;
  end if;

  -- Lines
  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (null, 'line', 'Florida CHCs', 0) returning id into florida;
  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (null, 'line', 'Sebring Execution', 1) returning id into sebring;

  -- ─── FLORIDA CHCs ─────────────────────────────────────────────────────
  -- Branding
  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (florida, 'section', 'Branding', 0) returning id into s_brand;

  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (s_brand, 'item', 'CHC Website (bare)', 0);

  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (s_brand, 'item', 'CHC + Product Page', 1) returning id into item_parent;
  idx := 0;
  foreach ch in array channels loop
    insert into public.campaign_nodes (parent_id, kind, title, sort_order)
      values (item_parent, 'channel', ch, idx);
    idx := idx + 1;
  end loop;

  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (s_brand, 'item', 'CHC + People Page', 2) returning id into item_parent;
  idx := 0;
  foreach ch in array channels loop
    insert into public.campaign_nodes (parent_id, kind, title, sort_order)
      values (item_parent, 'channel', ch, idx);
    idx := idx + 1;
  end loop;

  -- Campaign Core
  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (florida, 'section', 'Campaign Core', 1) returning id into s_core;
  insert into public.campaign_nodes (parent_id, kind, title, sort_order) values
    (s_core, 'item', 'Six units 3-day campaign broken down', 0),
    (s_core, 'item', 'Each individual campaign channel unit ready to go', 1),
    (s_core, 'item', 'Campaign metrics and Dashboard', 2);

  -- Campaign Ops
  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (florida, 'section', 'Campaign Ops', 2) returning id into s_ops;
  insert into public.campaign_nodes (parent_id, kind, title, sort_order) values
    (s_ops, 'item', 'Campaign Tool with integrations', 0),
    (s_ops, 'item', 'Channels set up, Ops and Message on the channel', 1),
    (s_ops, 'item', 'Snail mail set up', 2);

  -- Messaging
  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (florida, 'section', 'Messaging', 3) returning id into s_msg;

  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (s_msg, 'item', 'Messaging framework for each campaign channel unit', 0)
    returning id into item_parent;
  idx := 0;
  foreach ch in array msg_channels loop
    insert into public.campaign_nodes (parent_id, kind, title, sort_order)
      values (item_parent, 'channel', ch, idx);
    idx := idx + 1;
  end loop;

  insert into public.campaign_nodes (parent_id, kind, title, sort_order) values
    (s_msg, 'item', 'Personalized videos for each CHC', 1),
    (s_msg, 'item', 'Personalised Video - scaling formula', 2);

  -- ─── SEBRING EXECUTION ────────────────────────────────────────────────
  -- Branding
  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (sebring, 'section', 'Branding', 0) returning id into s_brand;

  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (s_brand, 'item', 'Sebring Website (bare)', 0);

  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (s_brand, 'item', 'CHC + Sebring Product Page', 1) returning id into item_parent;
  idx := 0;
  foreach ch in array channels loop
    insert into public.campaign_nodes (parent_id, kind, title, sort_order)
      values (item_parent, 'channel', ch, idx);
    idx := idx + 1;
  end loop;

  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (s_brand, 'item', 'CHC + Sebring People Page', 2) returning id into item_parent;
  idx := 0;
  foreach ch in array channels loop
    insert into public.campaign_nodes (parent_id, kind, title, sort_order)
      values (item_parent, 'channel', ch, idx);
    idx := idx + 1;
  end loop;

  -- Campaign Core
  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (sebring, 'section', 'Campaign Core', 1) returning id into s_core;
  insert into public.campaign_nodes (parent_id, kind, title, sort_order) values
    (s_core, 'item', 'Six units 3-day campaign broken down', 0),
    (s_core, 'item', 'Each individual campaign channel unit ready to go', 1),
    (s_core, 'item', 'Campaign metrics and Dashboard', 2);

  -- Campaign Ops
  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (sebring, 'section', 'Campaign Ops', 2) returning id into s_ops;
  insert into public.campaign_nodes (parent_id, kind, title, sort_order) values
    (s_ops, 'item', 'Campaign Tool with integrations', 0),
    (s_ops, 'item', 'Channels set up, Ops and Message on the channel', 1),
    (s_ops, 'item', 'Snail mail set up', 2);

  -- Messaging
  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (sebring, 'section', 'Messaging', 3) returning id into s_msg;

  insert into public.campaign_nodes (parent_id, kind, title, sort_order)
    values (s_msg, 'item', 'Messaging framework for each campaign channel unit', 0)
    returning id into item_parent;
  idx := 0;
  foreach ch in array msg_channels loop
    insert into public.campaign_nodes (parent_id, kind, title, sort_order)
      values (item_parent, 'channel', ch, idx);
    idx := idx + 1;
  end loop;

  insert into public.campaign_nodes (parent_id, kind, title, sort_order) values
    (s_msg, 'item', 'Personalized videos for each practice in Sebring', 1),
    (s_msg, 'item', 'Personalised Video - scaling formula', 2);
end $$;
