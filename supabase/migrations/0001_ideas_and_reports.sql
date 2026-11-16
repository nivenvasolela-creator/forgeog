-- FORGE workspaces: one row per idea, one report row per analysis run.
-- Run this once in the Supabase SQL editor (or with `supabase db push`).

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  raw_idea text not null,
  clarification text,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index ideas_user_updated_idx on public.ideas (user_id, updated_at desc);
create index reports_idea_created_idx on public.reports (idea_id, created_at desc);

alter table public.ideas enable row level security;
alter table public.reports enable row level security;

-- Each user can only see and change their own rows.
create policy "ideas are private to their owner" on public.ideas
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "reports are private to their owner" on public.reports
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.ideas i
      where i.id = idea_id and i.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.ideas, public.reports to authenticated;
