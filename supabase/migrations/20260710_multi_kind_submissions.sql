-- Milestone submissions: files, links, and text notes.
-- Original table only stored files (storage_path required). Extending so each
-- row can also be a link or a text note — and adding a reviewed flag so the UI
-- can highlight new/pending items distinctly.

alter table public.milestone_node_attachments
  add column if not exists kind text not null default 'file'
    check (kind in ('file','link','text')),
  add column if not exists link_url text,
  add column if not exists text_body text,
  add column if not exists reviewed boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.users(id);

-- Files still need a storage path, but links/text do not.
alter table public.milestone_node_attachments
  alter column storage_path drop not null;

-- Sanity: file kind must have a storage_path, link kind must have link_url,
-- text kind must have text_body.
alter table public.milestone_node_attachments
  drop constraint if exists submission_kind_payload_check;
alter table public.milestone_node_attachments
  add constraint submission_kind_payload_check check (
    (kind = 'file' and storage_path is not null) or
    (kind = 'link' and link_url is not null) or
    (kind = 'text' and text_body is not null)
  );

create index if not exists milestone_attachments_reviewed_idx
  on public.milestone_node_attachments (node_id, reviewed);
