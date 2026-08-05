-- Add a 5th level to the milestone tree: Sub-task under Task.
-- Milestone > Goal > Sub-goal > Task > Sub-task.
-- Sub-tasks are leaves — they can only be children of Task nodes.
--
-- The kind column is a text CHECK constraint (see 20260702_milestone_tree.sql),
-- not a Postgres ENUM, so we drop and re-create the check to include the new
-- value. Idempotent via `drop constraint if exists`.
--
-- Parent-kind rules for the existing 4 levels are enforced only at the API
-- layer (there is no DB constraint on parent kind); we keep that pattern and
-- document Sub-task's constraint in a comment rather than a trigger.

alter table public.milestone_nodes
  drop constraint if exists milestone_nodes_kind_check;

alter table public.milestone_nodes
  add constraint milestone_nodes_kind_check
  check (kind in ('Milestone','Goal','Sub-goal','Task','Sub-task'));

comment on column public.milestone_nodes.kind is
  'Milestone > Goal > Sub-goal > Task > Sub-task. Sub-tasks are leaves and may only be children of Task nodes. Parent-kind rules are enforced at the API layer.';
