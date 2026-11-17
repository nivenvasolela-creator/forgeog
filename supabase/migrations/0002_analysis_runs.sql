-- One row per analysis started through the hosted `analyze` Edge Function.
-- The function counts a user's recent rows to rate limit them.

create table public.analysis_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index analysis_runs_user_created_idx
  on public.analysis_runs (user_id, created_at desc);

alter table public.analysis_runs enable row level security;

-- Users can add and count their own rows, but not edit or remove them.
create policy "users log their own analysis runs" on public.analysis_runs
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "users see their own analysis runs" on public.analysis_runs
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.analysis_runs from anon, authenticated;
grant select, insert on public.analysis_runs to authenticated;
