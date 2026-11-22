-- Arena — Figma Agent Bridge: relay tables (run once in YOUR Supabase project, SQL editor)
-- Then put your project URL + publishable key into ui.html CONFIG and manifest.json allowedDomains.

create extension if not exists pgcrypto;

create table if not exists public.arena_figma_commands (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  command_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','error')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.arena_figma_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  command_id uuid references public.arena_figma_commands(id) on delete set null,
  level text not null default 'info',
  message text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.arena_figma_exports (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  command_id uuid references public.arena_figma_commands(id) on delete set null,
  node_id text not null,
  node_name text,
  format text not null default 'PNG',
  scale double precision,
  width int,
  height int,
  data_base64 text not null,
  created_at timestamptz not null default now()
);

create index if not exists arena_figma_commands_session_status_idx on public.arena_figma_commands(session_id, status, created_at);
create index if not exists arena_figma_events_session_created_idx on public.arena_figma_events(session_id, created_at);
create index if not exists arena_figma_exports_session_idx on public.arena_figma_exports(session_id, created_at);

alter table public.arena_figma_commands enable row level security;
alter table public.arena_figma_events enable row level security;
alter table public.arena_figma_exports enable row level security;

-- The plugin uses the publishable (anon) key. Access is scoped by unguessable session UUIDs.
drop policy if exists arena_figma_commands_anon_all on public.arena_figma_commands;
create policy arena_figma_commands_anon_all on public.arena_figma_commands for all to anon using (true) with check (true);
drop policy if exists arena_figma_events_anon_all on public.arena_figma_events;
create policy arena_figma_events_anon_all on public.arena_figma_events for all to anon using (true) with check (true);
drop policy if exists arena_figma_exports_anon_all on public.arena_figma_exports;
create policy arena_figma_exports_anon_all on public.arena_figma_exports for all to anon using (true) with check (true);
