create extension if not exists pgcrypto;

create type project_runtime_status as enum (
  'healthy',
  'stale_governance',
  'awaiting_ceo',
  'blocked',
  'blocked_on_config',
  'cancelled'
);

create type run_status as enum (
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'awaiting_ceo',
  'blocked',
  'blocked_on_config'
);

create type run_stage as enum (
  'queued',
  'reading_context',
  'planning',
  'executing',
  'verifying',
  'updating_governance',
  'done',
  'blocked'
);

create type run_template as enum (
  'custom',
  'continue_project',
  'fix_blocker',
  'fix_issue',
  'review_next_move',
  'prep_qa',
  'investigate_issue'
);

create type event_type as enum (
  'run_launched',
  'run_stage_changed',
  'run_completed',
  'run_blocked',
  'run_awaiting_ceo',
  'decision_created',
  'decision_resolved',
  'message_created',
  'project_runtime_updated'
);

create type decision_status as enum (
  'open',
  'approved',
  'rejected',
  'resolved'
);

create type message_source as enum (
  'chat',
  'run_event',
  'system_notice'
);

create type message_role as enum (
  'user',
  'assistant',
  'system'
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_name text not null,
  repo_path text not null,
  is_self_managed boolean not null default false,
  phase text,
  progress integer not null default 0,
  launch_target text,
  runtime_status project_runtime_status,
  runtime_summary text,
  current_run_id uuid,
  current_stage run_stage,
  blocked_reason text,
  config_blocker_key text,
  config_blocker_detail text,
  governance_updated boolean not null default false,
  last_run_completed_at timestamptz,
  last_event_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scope text not null default 'project',
  title text,
  external_thread_key text,
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, external_thread_key)
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  thread_id uuid references public.threads(id) on delete set null,
  run_template run_template,
  instruction text not null,
  status run_status not null default 'queued',
  current_stage run_stage not null default 'queued',
  summary text,
  trigger_source text not null default 'chat',
  approval_required boolean not null default false,
  approval_state text,
  approval_reason text,
  approval_granted_at timestamptz,
  initial_git_head text,
  final_git_head text,
  commit_hash text,
  exit_reason text,
  config_blocker_key text,
  config_blocker_detail text,
  config_blocker_next_step text,
  governance_updated boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects
  add constraint projects_current_run_fk
  foreign key (current_run_id) references public.runs(id) on delete set null;

create table public.run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  step_key text not null,
  step_type text not null,
  status text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid references public.runs(id) on delete set null,
  decision_type text not null,
  title text not null,
  reason text,
  recommended_option text,
  selected_option text,
  status decision_status not null default 'open',
  payload jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  run_id uuid references public.runs(id) on delete set null,
  role message_role not null,
  source message_source not null,
  message_type text not null default 'default',
  content text not null,
  structured_content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid not null references public.runs(id) on delete cascade,
  artifact_type text not null,
  label text not null,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  run_id uuid references public.runs(id) on delete cascade,
  thread_id uuid references public.threads(id) on delete cascade,
  event_type event_type not null,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  visibility_scope text not null default 'project',
  created_at timestamptz not null default now()
);

create index idx_projects_name on public.projects(name);
create index idx_threads_project_id on public.threads(project_id);
create index idx_runs_project_id_created_at on public.runs(project_id, created_at desc);
create index idx_runs_thread_id_created_at on public.runs(thread_id, created_at desc);
create index idx_runs_status on public.runs(status);
create index idx_run_steps_run_id on public.run_steps(run_id);
create index idx_messages_thread_id_created_at on public.messages(thread_id, created_at);
create index idx_artifacts_run_id on public.artifacts(run_id);
create index idx_events_project_id_created_at on public.events(project_id, created_at desc);
create index idx_events_thread_id_created_at on public.events(thread_id, created_at desc);
create index idx_events_run_id_created_at on public.events(run_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create trigger trg_threads_updated_at
before update on public.threads
for each row execute function public.set_updated_at();

create trigger trg_runs_updated_at
before update on public.runs
for each row execute function public.set_updated_at();

create trigger trg_run_steps_updated_at
before update on public.run_steps
for each row execute function public.set_updated_at();

create trigger trg_decisions_updated_at
before update on public.decisions
for each row execute function public.set_updated_at();

create trigger trg_messages_updated_at
before update on public.messages
for each row execute function public.set_updated_at();
