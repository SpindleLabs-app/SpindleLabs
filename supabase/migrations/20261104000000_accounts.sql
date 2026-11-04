-- Optional accounts: what SpindleLabs keeps about a person who signs in.
-- Designs are never stored here; they stay on the person's device.
--
-- Every table has row level security, and the browser's roles (anon,
-- authenticated) get only the grants written below: Supabase grants ALL on
-- new public tables to them by default, so each table starts by taking that
-- back. supabase/test/test_database.py checks every rule here against a real
-- PostgreSQL, including the default grants.

-- One row per person, made when they first sign in.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Emails about new features and Pro: only with a separate, unticked-by-default yes (Spam Act 2003).
  email_opt_in boolean not null default false,
  -- When that yes or no was last given: the record of consent.
  email_opt_in_changed_at timestamptz
);

-- The person's plan. Written only by the server (payments, later); the person can read their own.
create table public.plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  renews_at timestamptz,
  updated_at timestamptz not null default now()
);

-- AI allowance for the current period, in millionths of a US dollar. Never read by the browser
-- directly: it gets only the percentage used, from my_allowance().
create table public.ai_allowance (
  user_id uuid primary key references auth.users (id) on delete cascade,
  period_start timestamptz not null default now(),
  used_micro_usd bigint not null default 0 check (used_micro_usd >= 0),
  limit_micro_usd bigint not null default 0 check (limit_micro_usd >= 0)
);

revoke all on public.profiles, public.plans, public.ai_allowance from anon, authenticated;
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.ai_allowance enable row level security;

grant select on public.profiles to authenticated;
grant update (email_opt_in) on public.profiles to authenticated;
create policy "own profile: read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile: change the email choice" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

grant select on public.plans to authenticated;
create policy "own plan: read" on public.plans for select to authenticated using (user_id = auth.uid());

-- No grant and no policy on ai_allowance for the browser's roles: only my_allowance() reads it.

-- The consent record follows every change of the email choice, set by the database, not the browser.
create function public.stamp_email_choice() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.email_opt_in is distinct from old.email_opt_in then
    new.email_opt_in_changed_at := now();
  end if;
  return new;
end $$;
create trigger stamp_email_choice before update on public.profiles
  for each row execute function public.stamp_email_choice();

-- A new sign-in gets its rows: a profile with emails off, the free plan and no allowance.
create function public.new_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.plans (user_id) values (new.id);
  insert into public.ai_allowance (user_id) values (new.id);
  return new;
end $$;
create trigger new_account after insert on auth.users
  for each row execute function public.new_account();

-- The share of this period's AI allowance used, as a whole percentage rounded down
-- (so the 80% warning shows only at 80% or more), at most 100; null with no allowance.
create function public.my_allowance() returns integer
language sql stable security definer set search_path = '' as $$
  select case when a.limit_micro_usd = 0 then null
              else least(100, (a.used_micro_usd * 100) / a.limit_micro_usd)::integer end
  from public.ai_allowance a where a.user_id = auth.uid()
$$;

-- Everything kept about the person, for them to see or take away (Privacy Act, APP 12).
create function public.my_data() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'from_google', u.raw_user_meta_data) from auth.users u where u.id = auth.uid()),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'plan', (select to_jsonb(l) from public.plans l where l.user_id = auth.uid()),
    'ai_allowance_used_percent', public.my_allowance())
  where auth.uid() is not null
$$;

-- Delete my account: removes the sign-in and, through the foreign keys, every row above.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.stamp_email_choice(), public.new_account(), public.my_allowance(), public.my_data(), public.delete_my_account() from public, anon, authenticated;
grant execute on function public.my_allowance(), public.my_data(), public.delete_my_account() to authenticated;
