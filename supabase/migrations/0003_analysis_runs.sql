-- Usage log behind the hosted API's rate limit. Only the edge function,
-- using the service role, can read or write it.

create table public.analysis_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index analysis_runs_user_created_idx
  on public.analysis_runs (user_id, created_at desc);

-- Row level security with no policies: signed-in users get no access at all.
alter table public.analysis_runs enable row level security;
revoke all on public.analysis_runs from anon, authenticated;

-- Records one run for the user unless they already have p_max runs inside
-- the window. Returns whether the run is allowed.
create function public.record_analysis_run(
  p_user_id uuid,
  p_max integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  -- Serialise concurrent calls for the same user so the count cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  delete from public.analysis_runs
    where user_id = p_user_id and created_at < now() - interval '1 day';

  select count(*) into recent
    from public.analysis_runs
    where user_id = p_user_id
      and created_at > now() - make_interval(secs => p_window_seconds);

  if recent >= p_max then
    return false;
  end if;

  insert into public.analysis_runs (user_id) values (p_user_id);
  return true;
end;
$$;

revoke all on function public.record_analysis_run(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_analysis_run(uuid, integer, integer)
  to service_role;
