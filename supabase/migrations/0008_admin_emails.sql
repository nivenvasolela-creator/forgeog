-- Team emails that become admins automatically when they sign up (or right
-- away, if the account already exists). Rows are added by hand in SQL and are
-- never readable from the app.
create table public.admin_emails (
  email text primary key check (email = lower(email))
);

alter table public.admin_emails enable row level security;

create function public.grant_admin_by_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.admin_emails where email = lower(new.email)) then
    insert into public.admins (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.grant_admin_by_email() from public, anon, authenticated;

create trigger grant_admin_on_signup
  after insert on auth.users
  for each row execute function public.grant_admin_by_email();
