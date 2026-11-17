-- Validation plan: experiments a founder runs against an idea, with outcomes.

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.ideas (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  status text not null default 'todo' check (status in ('todo', 'running', 'done')),
  outcome text check (outcome in ('supported', 'refuted', 'inconclusive')),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index experiments_idea_created_idx on public.experiments (idea_id, created_at);
create index experiments_user_idx on public.experiments (user_id);

alter table public.experiments enable row level security;

create policy "experiments are private to their owner" on public.experiments
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.ideas i
      where i.id = idea_id and i.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.experiments to authenticated;
