-- Two-way thread on every campaign leaf. Owners can reply to feedback as text,
-- and reps can leave comments even without a pending submission.

create table if not exists public.campaign_thread_messages (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.campaign_nodes(id) on delete cascade,
  submission_id uuid references public.campaign_submissions(id) on delete set null,
  author_email text not null,
  author_role text not null check (author_role in ('owner','rep','admin')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists campaign_thread_messages_node_idx
  on public.campaign_thread_messages(node_id, created_at);

-- Backfill: for each existing submission with a rep decision + feedback,
-- insert a corresponding rep-authored thread message (idempotent — skip if
-- a message already exists for that submission_id).
insert into public.campaign_thread_messages
  (node_id, submission_id, author_email, author_role, body, created_at)
select
  s.node_id,
  s.id,
  coalesce(s.decided_by, 'unknown'),
  'rep',
  s.feedback,
  coalesce(s.decided_at, s.uploaded_at)
from public.campaign_submissions s
where s.feedback is not null
  and length(btrim(s.feedback)) > 0
  and not exists (
    select 1 from public.campaign_thread_messages m
    where m.submission_id = s.id
  );
