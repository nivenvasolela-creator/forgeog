-- Ask FORGE (the founder's chat with FORGE) and the Telegram bot that carries
-- the same chat plus a morning brief. Only the `analyze` edge function
-- (service role) writes these rows; founders can read their own.

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 8000),
  -- assistant: { sources: [{title,url}], actions: [...] }
  data jsonb not null default '{}'::jsonb,
  idea_id uuid references public.ideas (id) on delete set null,
  channel text not null default 'web' check (channel in ('web', 'telegram')),
  created_at timestamptz not null default now()
);

create index chat_messages_user_created_idx on public.chat_messages (user_id, created_at desc);

alter table public.chat_messages enable row level security;

create policy "users read their own chat" on public.chat_messages
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users clear their own chat" on public.chat_messages
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.chat_messages to authenticated;

create table public.telegram_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chat_id bigint unique,
  -- One-time code carried by the t.me/<bot>?start=<code> link.
  link_code text unique,
  code_expires_at timestamptz,
  brief_enabled boolean not null default true,
  last_brief_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.telegram_links enable row level security;

create policy "users see their own telegram link" on public.telegram_links
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users change their own telegram link" on public.telegram_links
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "users remove their own telegram link" on public.telegram_links
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Founders may only switch the brief on or off themselves.
grant select, delete on public.telegram_links to authenticated;
grant update (brief_enabled) on public.telegram_links to authenticated;

-- Morning brief at 07:00 Tanzania time (04:00 UTC). Each founder gets at most
-- one brief a day, so an extra call does no harm.
-- When reusing this file for another Supabase project, change the URL below.
select cron.schedule(
  'forge-morning-brief',
  '0 4 * * *',
  $cron$
    select net.http_post(
      url := 'https://bypsmyxdewspfgncbrnp.supabase.co/functions/v1/analyze?action=brief',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    )
    where exists (
      select 1 from public.telegram_links
       where chat_id is not null and brief_enabled
    );
  $cron$
);
