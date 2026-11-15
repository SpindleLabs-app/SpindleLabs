-- Community testers (Ben, 2026-11-15: try the community features before their legal check). The app's `?community`
-- switch only shows them (apps/fission, @fission/core preview.ts): anyone can type it. This is what actually opens
-- them, and only to the accounts listed here, while `share_switch` stays off for everyone else.
--
-- How: `sharing_on()`, which every sharing, likes and library function and the library's Storage policies already ask
-- first, now answers for the person asking: on when the switch is on (as before), or when the person asking is a
-- tester. For anyone who is not on the list (signed out, signed in, or the server itself) it answers exactly as it did,
-- so nothing opens to them, and nothing a tester shares, publishes or likes can be opened, listed or downloaded by them:
-- every way to read those goes through `sharing_on()`. Turning Friends on now asks it too (`set_friends`'s new answer
-- "not-yet"), since Friends waits on the same legal items (17, 18, 19, 21 and 29).
--
-- Adding a tester (Supabase dashboard > SQL editor, by the owner only; the browser can neither read nor change this):
--   insert into public.community_testers (user_id) select id from auth.users where email = '<their email>';
-- Removing one: delete from public.community_testers where user_id = (select id from auth.users where email = '...');
-- Removing a tester closes everything again for them, and what they shared stays closed to everyone until sharing opens.
-- supabase/test/test_community_testers.py checks every rule here on a real PostgreSQL.

create table public.community_testers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
revoke all on public.community_testers from anon, authenticated;
alter table public.community_testers enable row level security;
-- No policy: only the functions below and the owner touch it.

-- On for everyone once the owner turns sharing on; until then, only for a tester asking.
create or replace function public.sharing_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select sharing_on from public.share_switch where id), false)
    or exists (select from public.community_testers where user_id = auth.uid())
$$;
revoke all on function public.sharing_on() from public, anon, authenticated;

-- As in 20261113200000_account_security.sql, with turning on refused as "not-yet" while sharing isn't on for the person
-- asking. Turning off always works, and someone already on stays on (their friends and requests are theirs).
create or replace function public.set_friends(p_on boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if p_on is not true then
    delete from public.friend_codes where user_id = me;
    delete from public.friendships where a = me or b = me;
    delete from public.friend_requests where to_user = me or (from_user = me and not declined);
    update public.friend_requests set cancelled_at = coalesce(cancelled_at, now()) where from_user = me;
    return 'off';
  end if;
  if exists (select from public.friend_codes where user_id = me) then
    return 'on';
  end if;
  if not public.sharing_on() then
    return 'not-yet';
  end if;
  if public.account_held(me) then
    return 'held';
  end if;
  if not exists (select from public.display_names where user_id = me) then
    return 'no-name';
  end if;
  perform public.friend_code_give(me);
  return 'on';
end $$;
revoke all on function public.set_friends(boolean) from public, anon;
grant execute on function public.set_friends(boolean) to authenticated;
