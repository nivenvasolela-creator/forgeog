-- Parks the pre-existing (empty) tables from an earlier FORGE prototype in a
-- `legacy` schema so they no longer clash with the tables below. Nothing is
-- deleted; `alter table legacy.<name> set schema public` brings one back.
-- Safe to run on a fresh project: it only moves tables that exist.

create schema if not exists legacy;
revoke all on schema legacy from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'users', 'ideas', 'profiles', 'analytics', 'founder_memories',
    'investor_simulations', 'sentinel_logs', 'venture_stats', 'weekly_digests'
  ] loop
    if to_regclass('public.' || t) is not null
       and to_regclass('legacy.' || t) is null then
      execute format('alter table public.%I set schema legacy', t);
    end if;
  end loop;
end $$;
