-- Nexus: FORGE's background engine. Each analysis or sprint is a job that the
-- `analyze` edge function runs one short step at a time, so it survives
-- closed browsers, the hosted 150 s request limit and model quota errors.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('analyze', 'sprint')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'needs_input', 'done', 'failed')),
  -- analyze: start (clarity) -> scout -> analyst -> skeptic; sprint: start
  step text not null default 'start',
  input jsonb not null,
  -- Results handed from one step to the next.
  state jsonb not null default '{}'::jsonb,
  -- done: { ideaId }; needs_input: { question }
  result jsonb,
  error text,
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_due_idx on public.jobs (status, run_after);
create index jobs_user_created_idx on public.jobs (user_id, created_at desc);

-- Founders can watch their own jobs. Only the edge function (service role)
-- creates and changes them.
alter table public.jobs enable row level security;

create policy "users see their own jobs" on public.jobs
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.jobs to authenticated;

-- Hands the next due job to one worker. A job left "running" for over four
-- minutes is treated as abandoned (its worker was stopped) and handed out again.
create function public.nexus_claim_job()
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not allowed';
  end if;

  return query
  update public.jobs as j
     set status = 'running', updated_at = now()
   where j.id = (
     select id from public.jobs
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and updated_at < now() - interval '4 minutes')
      order by run_after, created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end;
$$;

-- Every minute, wake the engine if any job is waiting. Steps also start the
-- next one straight away, so this is the safety net (and what resumes jobs
-- that paused for model quota).
-- When reusing this file for another Supabase project, change the URL below.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'nexus-tick',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://bypsmyxdewspfgncbrnp.supabase.co/functions/v1/analyze?action=tick',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    )
    where exists (
      select 1 from public.jobs
       where (status = 'queued' and run_after <= now())
          or (status = 'running' and updated_at < now() - interval '4 minutes')
    );
  $cron$
);
