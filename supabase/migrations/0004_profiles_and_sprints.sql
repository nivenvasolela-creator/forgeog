-- Founder profile: what FORGE remembers about the person, used in every
-- analysis and plan. One row per user.
create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 80),
  country text not null default '' check (char_length(country) <= 80),
  city text not null default '' check (char_length(city) <= 80),
  background text not null default '' check (char_length(background) <= 800),
  skills text not null default '' check (char_length(skills) <= 500),
  hours_per_week text not null default '' check (char_length(hours_per_week) <= 80),
  budget text not null default '' check (char_length(budget) <= 120),
  goal text not null default '' check (char_length(goal) <= 500),
  language text not null default 'en' check (language in ('en', 'sw')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are private to their owner" on public.profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.profiles to authenticated;

-- Execution sprint: the current 7-day plan for an idea, including which tasks
-- are done. One per idea; building a new sprint replaces it.
create table public.sprints (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null unique references public.ideas (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sprints_user_idx on public.sprints (user_id);

alter table public.sprints enable row level security;

create policy "sprints are private to their owner" on public.sprints
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.ideas i
      where i.id = idea_id and i.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.sprints to authenticated;
