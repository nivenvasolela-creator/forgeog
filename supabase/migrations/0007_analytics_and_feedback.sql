-- Product analytics and feedback. Founders' browsers record what they use
-- (events); feedback goes through the `analyze` edge function, which also
-- notifies the team. Only admins can read either, through admin_stats().

create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id text check (char_length(session_id) <= 64),
  name text not null check (name ~ '^[a-z_]{2,40}$'),
  screen text check (char_length(screen) <= 40),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) < 4000),
  created_at timestamptz not null default now()
);

create index events_created_idx on public.events (created_at);
create index events_name_created_idx on public.events (name, created_at);
create index events_user_created_idx on public.events (user_id, created_at);

alter table public.events enable row level security;

create policy "users record their own events" on public.events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

grant insert on public.events to authenticated;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('bug', 'idea', 'confusing', 'praise', 'rating', 'other')),
  -- 1 (bad) to 4 (great); thumbs are 1 and 4.
  rating smallint check (rating between 1 and 4),
  message text not null default '' check (char_length(message) <= 4000),
  screen text check (char_length(screen) <= 40),
  context jsonb not null default '{}'::jsonb check (pg_column_size(context) < 4000),
  contact_ok boolean not null default false,
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at timestamptz not null default now()
);

create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_user_created_idx on public.feedback (user_id, created_at);

-- Written by the edge function only; read through admin_stats().
alter table public.feedback enable row level security;

-- The team. Rows are added by hand in SQL, never from the app.
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Everything the admin dashboard shows, for the last p_days days.
create function public.admin_stats(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 90)));
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  select jsonb_build_object(
    'since', since,
    'users_total', (select count(*) from auth.users),
    'users_new', (select count(*) from auth.users where created_at >= since),
    'active_today', (select count(distinct user_id) from public.events
                      where created_at >= date_trunc('day', now())),
    'active_7d', (select count(distinct user_id) from public.events
                   where created_at >= now() - interval '7 days'),
    'active_period', (select count(distinct user_id) from public.events where created_at >= since),
    -- People who came back on a second, different day.
    'returning', (select count(*) from (
                    select user_id from public.events where created_at >= since
                    group by user_id having count(distinct created_at::date) >= 2) r),
    'ideas', (select count(*) from public.ideas where created_at >= since),
    'reports', (select count(*) from public.reports where created_at >= since),
    'sprints', (select count(*) from public.sprints where created_at >= since),
    'questions', (select count(*) from public.chat_messages where role = 'user' and created_at >= since),
    -- Of the people who signed up in the period, how far each got.
    'funnel', jsonb_build_object(
      'signed_up', (select count(*) from auth.users u where u.created_at >= since),
      'profile', (select count(*) from public.profiles p join auth.users u on u.id = p.user_id
                   where u.created_at >= since),
      'tested_idea', (select count(distinct i.user_id) from public.ideas i join auth.users u on u.id = i.user_id
                       where u.created_at >= since),
      'built_sprint', (select count(distinct s.user_id) from public.sprints s join auth.users u on u.id = s.user_id
                        where u.created_at >= since),
      'did_a_task', (select count(distinct s.user_id) from public.sprints s join auth.users u on u.id = s.user_id
                      where u.created_at >= since and jsonb_array_length(coalesce(s.data -> 'done', '[]'::jsonb)) > 0),
      'finished_test', (select count(distinct e.user_id) from public.experiments e join auth.users u on u.id = e.user_id
                         where u.created_at >= since and e.status = 'done'),
      'asked_forge', (select count(distinct c.user_id) from public.chat_messages c join auth.users u on u.id = c.user_id
                       where u.created_at >= since and c.role = 'user'),
      'came_back', (select count(*) from (
                      select e.user_id from public.events e join auth.users u on u.id = e.user_id
                       where u.created_at >= since
                       group by e.user_id having count(distinct e.created_at::date) >= 2) r)
    ),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c, 'users', u) order by c desc), '[]'::jsonb)
                 from (select name, count(*) c, count(distinct user_id) u from public.events
                        where created_at >= since and name not in ('screen_view', 'client_error')
                        group by name order by c desc limit 30) x),
    'screens', (select coalesce(jsonb_agg(jsonb_build_object('name', screen, 'count', c, 'users', u) order by c desc), '[]'::jsonb)
                  from (select coalesce(props ->> 'screen', screen) screen, count(*) c, count(distinct user_id) u
                          from public.events where created_at >= since and name = 'screen_view'
                         group by 1 order by c desc limit 12) x),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'users', coalesce(ev.u, 0),
                                                           'signups', coalesce(su.n, 0)) order by d), '[]'::jsonb)
                from generate_series(date_trunc('day', since), date_trunc('day', now()), interval '1 day') d
                left join (select date_trunc('day', created_at) as bucket, count(distinct user_id) u
                             from public.events where created_at >= since group by 1) ev on ev.bucket = d
                left join (select date_trunc('day', created_at) as bucket, count(*) n
                             from auth.users where created_at >= since group by 1) su on su.bucket = d),
    'decisions', (select coalesce(jsonb_object_agg(verdict, c), '{}'::jsonb)
                    from (select coalesce(data -> 'decision' ->> 'call', 'none') as verdict, count(*) c
                            from public.reports where created_at >= since group by 1) x),
    'languages', (select coalesce(jsonb_object_agg(lang, c), '{}'::jsonb)
                    from (select language as lang, count(*) c from public.profiles group by 1) x),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('name', country, 'count', c) order by c desc), '[]'::jsonb)
                    from (select initcap(trim(country)) country, count(*) c from public.profiles
                           where trim(country) <> '' group by 1 order by c desc limit 8) x),
    'jobs', (select jsonb_build_object(
                      'done', count(*) filter (where status = 'done'),
                      'failed', count(*) filter (where status = 'failed'),
                      'waiting', count(*) filter (where status in ('queued', 'running')),
                      'quota_waits', count(*) filter (where error = 'quota'))
               from public.jobs where created_at >= since),
    'job_errors', (select coalesce(jsonb_agg(jsonb_build_object('error', error, 'count', c) order by c desc), '[]'::jsonb)
                     from (select left(error, 200) error, count(*) c from public.jobs
                            where status = 'failed' and created_at >= since group by 1 order by 2 desc limit 8) x),
    'client_errors', (select coalesce(jsonb_agg(jsonb_build_object('error', msg, 'count', c, 'users', u) order by c desc), '[]'::jsonb)
                        from (select left(props ->> 'message', 200) msg, count(*) c, count(distinct user_id) u
                                from public.events where name = 'client_error' and created_at >= since
                               group by 1 order by 2 desc limit 8) x),
    'ratings', (select jsonb_build_object(
                         'up', count(*) filter (where rating >= 3),
                         'down', count(*) filter (where rating <= 2))
                  from public.feedback where kind = 'rating' and created_at >= since),
    'feedback', (select coalesce(jsonb_agg(f order by f.created_at desc), '[]'::jsonb)
                   from (select fb.id, fb.kind, fb.rating, fb.message, fb.screen, fb.context, fb.status,
                                fb.created_at, case when fb.contact_ok then u.email end as email
                           from public.feedback fb left join auth.users u on u.id = fb.user_id
                          where fb.kind <> 'rating' or fb.message <> ''
                          order by fb.created_at desc limit 60) f),
    'recent_questions', (select coalesce(jsonb_agg(jsonb_build_object('text', t, 'at', created_at, 'channel', channel)
                                                   order by created_at desc), '[]'::jsonb)
                           from (select left(content, 240) t, created_at, channel from public.chat_messages
                                  where role = 'user' and created_at >= since
                                  order by created_at desc limit 40) q)
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_stats(integer) from public, anon;
grant execute on function public.admin_stats(integer) to authenticated;

create function public.admin_set_feedback_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  update public.feedback set status = p_status where id = p_id;
end;
$$;

revoke all on function public.admin_set_feedback_status(uuid, text) from public, anon;
grant execute on function public.admin_set_feedback_status(uuid, text) to authenticated;
