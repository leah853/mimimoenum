-- ============================================
-- MIMIMOMENTUM — Production Schema
-- Supabase PostgreSQL
-- ============================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ============================================
-- ENUMS
-- ============================================
do $$ begin
  create type user_role as enum ('admin', 'eonexea', 'mimimomentum');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type task_status as enum ('not_started', 'in_progress', 'under_review', 'completed', 'blocked');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type feedback_tag as enum ('approved', 'needs_improvement', 'blocked');
exception when duplicate_object then null;
end $$;

-- ============================================
-- USERS
-- ============================================
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  auth_id uuid unique,
  email text unique not null,
  full_name text not null,
  role user_role not null default 'eonexea',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- ALLOWED EMAILS (access control)
-- ============================================
create table if not exists allowed_emails (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  role user_role not null default 'eonexea',
  created_at timestamptz not null default now()
);

-- ============================================
-- QUARTERS
-- ============================================
create table if not exists quarters (
  id uuid primary key default uuid_generate_v4(),
  name text unique not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  constraint quarters_dates_valid check (end_date > start_date)
);

-- ============================================
-- ITERATIONS
-- ============================================
create table if not exists iterations (
  id uuid primary key default uuid_generate_v4(),
  quarter_id uuid not null references quarters(id) on delete cascade,
  name text not null,
  iteration_number int not null check (iteration_number between 1 and 12),
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  unique(quarter_id, iteration_number),
  constraint iterations_dates_valid check (end_date > start_date)
);

-- ============================================
-- WEEKS
-- ============================================
create table if not exists weeks (
  id uuid primary key default uuid_generate_v4(),
  iteration_id uuid not null references iterations(id) on delete cascade,
  week_number int not null check (week_number between 1 and 5),
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  unique(iteration_id, week_number),
  constraint weeks_dates_valid check (end_date >= start_date)
);

-- ============================================
-- TASKS
-- ============================================
create table if not exists tasks (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  category text,
  owner_id uuid not null references users(id),
  status task_status not null default 'not_started',
  deadline date not null,
  start_date date,
  end_date date,
  quarter_id uuid references quarters(id) on delete cascade,
  iteration_id uuid references iterations(id) on delete set null,
  week_id uuid references weeks(id) on delete set null,
  progress int not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- SUBTASKS
-- ============================================
create table if not exists subtasks (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references tasks(id) on delete cascade,
  title text not null,
  description text,
  owner_id uuid references users(id),
  status task_status not null default 'not_started',
  deadline date,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- DEPENDENCIES (many-to-many task graph)
-- ============================================
create table if not exists dependencies (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references tasks(id) on delete cascade,
  depends_on_task_id uuid not null references tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(task_id, depends_on_task_id),
  constraint no_self_dependency check (task_id != depends_on_task_id)
);

-- ============================================
-- DELIVERABLES (versioned, file-only)
-- ============================================
create table if not exists deliverables (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid references tasks(id) on delete cascade,
  subtask_id uuid references subtasks(id) on delete cascade,
  title text not null,
  file_url text not null,
  file_name text,
  file_size_bytes bigint,
  version int not null default 1,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint deliverable_has_parent check (task_id is not null or subtask_id is not null)
);

-- ============================================
-- FEEDBACK
-- ============================================
create table if not exists feedback (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid references tasks(id) on delete cascade,
  subtask_id uuid references subtasks(id) on delete cascade,
  reviewer_id uuid not null references users(id),
  rating int not null check (rating between 1 and 10),
  comment text,
  tag feedback_tag not null,
  created_at timestamptz not null default now(),
  constraint feedback_has_parent check (task_id is not null or subtask_id is not null)
);

-- ============================================
-- EOD UPDATES
-- ============================================
create table if not exists eod_updates (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id),
  date date not null default current_date,
  what_was_done text not null,
  whats_next text,
  blockers text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, date)
);

-- EOD <-> Task links
create table if not exists eod_update_tasks (
  id uuid primary key default uuid_generate_v4(),
  eod_update_id uuid not null references eod_updates(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  unique(eod_update_id, task_id)
);

-- EOD comments
create table if not exists eod_comments (
  id uuid primary key default uuid_generate_v4(),
  eod_update_id uuid not null references eod_updates(id) on delete cascade,
  user_id uuid not null references users(id),
  comment text not null,
  created_at timestamptz not null default now()
);

-- ============================================
-- WEEK REPORTS (Wednesday / Saturday)
-- ============================================
create table if not exists week_reports (
  id uuid primary key default uuid_generate_v4(),
  week_id uuid not null references weeks(id) on delete cascade,
  report_type text not null check (report_type in ('wednesday', 'saturday')),
  content text not null,
  file_url text,
  submitted_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique(week_id, report_type)
);

-- Week report feedback (from investors)
create table if not exists week_report_feedback (
  id uuid primary key default uuid_generate_v4(),
  week_report_id uuid not null references week_reports(id) on delete cascade,
  reviewer_id uuid not null references users(id),
  rating int not null check (rating between 1 and 10),
  comment text,
  created_at timestamptz not null default now()
);

-- ============================================
-- INDEXES
-- ============================================
create index if not exists idx_tasks_quarter on tasks(quarter_id);
create index if not exists idx_tasks_iteration on tasks(iteration_id);
create index if not exists idx_tasks_week on tasks(week_id);
create index if not exists idx_tasks_owner on tasks(owner_id);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_tasks_deadline on tasks(deadline);
create index if not exists idx_tasks_category on tasks(category);
create index if not exists idx_subtasks_task on subtasks(task_id);
create index if not exists idx_deliverables_task on deliverables(task_id);
create index if not exists idx_feedback_task on feedback(task_id);
create index if not exists idx_feedback_rating on feedback(rating);
create index if not exists idx_eod_user_date on eod_updates(user_id, date);
create index if not exists idx_dependencies_task on dependencies(task_id);
create index if not exists idx_dependencies_depends on dependencies(depends_on_task_id);
create index if not exists idx_iterations_quarter on iterations(quarter_id);
create index if not exists idx_weeks_iteration on weeks(iteration_id);

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger tasks_updated_at before update on tasks
  for each row execute function update_updated_at();
create or replace trigger subtasks_updated_at before update on subtasks
  for each row execute function update_updated_at();
create or replace trigger eod_updates_updated_at before update on eod_updates
  for each row execute function update_updated_at();
create or replace trigger users_updated_at before update on users
  for each row execute function update_updated_at();

-- ============================================
-- BUSINESS RULE: No completion without deliverable + feedback
-- ============================================
create or replace function enforce_task_completion()
returns trigger as $$
begin
  if new.status = 'completed' and (old.status is null or old.status != 'completed') then
    -- Must have at least 1 deliverable
    if not exists (select 1 from deliverables where task_id = new.id) then
      raise exception 'TASK_NO_DELIVERABLE: Task cannot be completed without at least one deliverable';
    end if;
    -- Must have at least 1 feedback
    if not exists (select 1 from feedback where task_id = new.id) then
      raise exception 'TASK_NO_FEEDBACK: Task cannot be completed without feedback';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create or replace trigger enforce_task_completion_trigger
  before update on tasks
  for each row execute function enforce_task_completion();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table users enable row level security;
alter table tasks enable row level security;
alter table subtasks enable row level security;
alter table deliverables enable row level security;
alter table feedback enable row level security;
alter table eod_updates enable row level security;
alter table quarters enable row level security;
alter table iterations enable row level security;
alter table weeks enable row level security;
alter table week_reports enable row level security;
alter table week_report_feedback enable row level security;

-- Read access for all authenticated
create policy "read_all" on quarters for select using (true);
create policy "read_all" on iterations for select using (true);
create policy "read_all" on weeks for select using (true);
create policy "read_all" on users for select using (true);
create policy "read_all" on tasks for select using (true);
create policy "read_all" on subtasks for select using (true);
create policy "read_all" on deliverables for select using (true);
create policy "read_all" on feedback for select using (true);
create policy "read_all" on eod_updates for select using (true);
create policy "read_all" on week_reports for select using (true);
create policy "read_all" on week_report_feedback for select using (true);

-- Write: admin + eonexea can create/update tasks
create policy "tasks_write" on tasks for insert with check (
  exists (select 1 from users where auth_id = auth.uid() and role in ('admin', 'eonexea'))
);
create policy "tasks_update" on tasks for update using (
  exists (select 1 from users where auth_id = auth.uid() and role in ('admin', 'eonexea'))
);

-- Write: admin + eonexea can create/update subtasks
create policy "subtasks_write" on subtasks for insert with check (
  exists (select 1 from users where auth_id = auth.uid() and role in ('admin', 'eonexea'))
);
create policy "subtasks_update" on subtasks for update using (
  exists (select 1 from users where auth_id = auth.uid() and role in ('admin', 'eonexea'))
);

-- Write: admin + eonexea can upload deliverables
create policy "deliverables_write" on deliverables for insert with check (
  exists (select 1 from users where auth_id = auth.uid() and role in ('admin', 'eonexea'))
);

-- Write: admin + mimimomentum can leave feedback
create policy "feedback_write" on feedback for insert with check (
  exists (select 1 from users where auth_id = auth.uid() and role in ('admin', 'mimimomentum'))
);

-- Write: admin + eonexea can submit EOD
create policy "eod_write" on eod_updates for insert with check (
  exists (select 1 from users where auth_id = auth.uid() and role in ('admin', 'eonexea'))
);
create policy "eod_update" on eod_updates for update using (
  user_id = (select id from users where auth_id = auth.uid())
);

-- Write: week reports
create policy "week_reports_write" on week_reports for insert with check (
  exists (select 1 from users where auth_id = auth.uid() and role in ('admin', 'eonexea'))
);

-- Write: week report feedback (investors)
create policy "week_report_feedback_write" on week_report_feedback for insert with check (
  exists (select 1 from users where auth_id = auth.uid() and role in ('admin', 'mimimomentum'))
);

-- ============================================
-- STORAGE BUCKET
-- ============================================
-- Run in Supabase dashboard: Create a bucket called "deliverables" with public access
