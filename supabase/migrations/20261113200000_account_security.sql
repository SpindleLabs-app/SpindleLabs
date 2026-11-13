-- Fixes from the security hunt of 2026-11-13 on the account features (SpindleLabs-app/bug-reports#3). Nothing here
-- changes what a person can do; it closes ways a rule could be got round. Checked by supabase/test: test_friends.py,
-- test_designs.py (Download my data), test_print_log.py and test_database.py (sequences).

-- ---------------------------------------------------------------------------------------------------------------
-- Friends (20261113180000_friends.sql). One rule now covers declines and blocks: a request the other person said no
-- to (declined it, or blocked its asker) is kept until it is 30 days old whatever the asker does, and the asker sees
-- exactly what they would had it never been answered. So a block looks like a decline (the asker's request stays
-- waiting on their side, and unblocking changes nothing they can see), and taking a declined request back, or
-- turning Friends off and on, never puts it in front of the person who said no again. Becoming friends is done one
-- at a time, so two at the same moment can't pass 200 friends.
-- ---------------------------------------------------------------------------------------------------------------

-- When the asker took back (or turned off Friends over) a request the other person had said no to: hidden from the
-- asker, still kept, so asking again shows it to them waiting from that moment and never to the other person.
alter table public.friend_requests add column cancelled_at timestamptz;
alter table public.friend_requests add constraint friend_requests_cancelled_only_declined check (cancelled_at is null or declined);

-- Becoming friends, one at a time across the service, so the 200-friend count read just before can't be raced.
create function public.friends_join_lock() returns void
language sql security definer set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(7316006001);
$$;

create or replace function public.friends_shown(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  lim jsonb := public.friends_limits();
  fresh timestamptz := now() - make_interval(days => (lim->>'request_days')::integer);
  mine text;
begin
  select code into mine from public.friend_codes where user_id = p_user;
  return jsonb_build_object(
    'on', mine is not null,
    'code', mine,
    'friends', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', d.name, 'since', f.since) order by f.since desc, f.id)
      from public.friendships f left join public.display_names d on d.user_id = case when f.a = p_user then f.b else f.a end
      where f.a = p_user or f.b = p_user), '[]'::jsonb),
    'asking_me', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', d.name, 'sent_at', r.sent_at) order by r.sent_at desc, r.id)
      from public.friend_requests r left join public.display_names d on d.user_id = r.from_user
      where r.to_user = p_user and not r.declined and r.sent_at >= fresh and mine is not null
        and not exists (select from public.friend_blocks k where k.blocker = p_user and k.blocked = r.from_user)), '[]'::jsonb),
    'i_asked', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'sent_at', r.sent_at) order by r.sent_at desc, r.id)
      from public.friend_requests r where r.from_user = p_user and r.cancelled_at is null and r.sent_at >= fresh), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', d.name, 'since', k.made_at) order by k.made_at desc, k.id)
      from public.friend_blocks k left join public.display_names d on d.user_id = k.blocked where k.blocker = p_user), '[]'::jsonb),
    'tries_left', greatest(0, (lim->>'tries_a_day')::integer
      - (select count(*)::integer from public.friend_tries t where t.user_id = p_user and t.tried_at >= now() - interval '1 day')));
end $$;

-- Off: as before, except that a request of the person's that the other person said no to is kept (hidden from the
-- person, until it is 30 days old), so turning off and on can't put it in front of them again.
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
  if public.account_held(me) then
    return 'held';
  end if;
  if not exists (select from public.display_names where user_id = me) then
    return 'no-name';
  end if;
  perform public.friend_code_give(me);
  return 'on';
end $$;

-- As before, with: a request the asker took back after it was said no to is neither "waiting" nor a yes when the
-- other person asks; asking again un-hides it, waiting from now, without showing it to the other person; such a
-- request doesn't count among the 20 waiting; and becoming friends by asking back takes the join lock first.
create or replace function public.send_friend_request(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.friends_limits();
  key text := public.friend_code_key(p_code);
  them uuid;
  mine text;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  -- One request at a time per person, so the daily and waiting counts hold.
  select code into mine from public.friend_codes where user_id = me for update;
  if mine is null then
    return 'off';
  end if;
  if public.account_held(me) then
    return 'held';
  end if;
  if key is null then
    return 'bad';
  end if;
  perform public.friends_tidy(me);
  if (select count(*) from public.friend_tries where user_id = me) >= (lim->>'tries_a_day')::integer then
    return 'too-many';
  end if;
  insert into public.friend_tries (user_id) values (me);
  if key = mine then
    return 'self';
  end if;
  select user_id into them from public.friend_codes where code = key;
  if them is null then
    return 'not-found';
  end if;
  perform public.friends_tidy(them);
  if exists (select from public.friend_blocks where blocker = me and blocked = them) then
    return 'blocked';
  end if;
  if exists (select from public.friendships where a = least(me, them) and b = greatest(me, them)) then
    return 'already';
  end if;
  if exists (select from public.friend_requests where from_user = me and to_user = them and cancelled_at is null) then
    return 'waiting';
  end if;
  -- They asked first (still asking, and haven't blocked the asker): asking back is a yes.
  if exists (select from public.friend_requests where from_user = them and to_user = me and cancelled_at is null)
     and not exists (select from public.friend_blocks where blocker = them and blocked = me) then
    perform public.friends_join_lock();
    if public.friend_count(me) >= (lim->>'max_friends')::integer or public.friend_count(them) >= (lim->>'max_friends')::integer then
      return 'full';
    end if;
    perform public.friends_join(me, them);
    return 'friends';
  end if;
  if public.friend_count(me) >= (lim->>'max_friends')::integer
     or (select count(*) from public.friend_requests where from_user = me and cancelled_at is null) >= (lim->>'max_waiting')::integer then
    return 'full';
  end if;
  -- A request taken back after a no is asked again: it stays declined, shows to the asker waiting from now.
  insert into public.friend_requests (from_user, to_user, code) values (me, them, key)
    on conflict (from_user, to_user) do update set cancelled_at = null, sent_at = now(), code = excluded.code;
  return 'sent';
end $$;

-- As before, with the join lock taken before counting.
create or replace function public.accept_friend_request(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.friends_limits();
  them uuid;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if not exists (select from public.friend_codes where user_id = me) then
    return 'gone';
  end if;
  perform public.friends_tidy(me);
  select r.from_user into them from public.friend_requests r where r.id = p_id and r.to_user = me and not r.declined
    and not exists (select from public.friend_blocks k where k.blocker = me and k.blocked = r.from_user);
  if them is null then
    return 'gone';
  end if;
  perform public.friends_join_lock();
  if public.friend_count(me) >= (lim->>'max_friends')::integer or public.friend_count(them) >= (lim->>'max_friends')::integer then
    return 'full';
  end if;
  perform public.friends_join(me, them);
  return 'friends';
end $$;

-- Takes back a request the person sent. One nobody answered is deleted; one the other person said no to is only
-- hidden from the person (kept until it is 30 days old), so asking again can't put it in front of them. True when
-- the person had one showing.
create or replace function public.cancel_friend_request(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.friend_requests where id = p_id and from_user = auth.uid() and cancelled_at is null and not declined;
  if found then
    return true;
  end if;
  update public.friend_requests set cancelled_at = now() where id = p_id and from_user = auth.uid() and cancelled_at is null;
  return found;
end $$;

-- Blocks the other person of a friendship or of a request to the person (by its id): the friendship and the
-- person's own request to them go; their request to the person is kept, declined, exactly as a decline leaves it,
-- so the blocked person sees nothing change. They can never be the person's friend or show in their requests until
-- unblocked. True when p_id was one of these.
create or replace function public.block_friend(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  them uuid;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  select case when f.a = me then f.b else f.a end into them from public.friendships f where f.id = p_id and (f.a = me or f.b = me);
  if them is null then
    select r.from_user into them from public.friend_requests r where r.id = p_id and r.to_user = me;
  end if;
  if them is null then
    return false;
  end if;
  insert into public.friend_blocks (blocker, blocked) values (me, them) on conflict (blocker, blocked) do nothing;
  delete from public.friendships where a = least(me, them) and b = greatest(me, them);
  delete from public.friend_requests where from_user = me and to_user = them;
  update public.friend_requests set declined = true where from_user = them and to_user = me;
  return true;
end $$;

-- Takes a block away (by its id). A request that person sent before or during the block stays, declined, never
-- shown (the asker sees nothing change). True when there was one.
create or replace function public.unblock_friend(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  them uuid;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  delete from public.friend_blocks where id = p_id and blocker = me returning blocked into them;
  if them is null then
    return false;
  end if;
  update public.friend_requests set declined = true where from_user = them and to_user = me;
  return true;
end $$;

revoke all on function public.friends_join_lock() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Download my data (20261105120000_my_designs.sql). One my_data() on a full account holds 130-195 MB of the
-- database's memory while it builds, so the browser no longer calls it directly: download_my_data() gives the same,
-- at most once a minute and 5 times a day a person, one at a time. Within the limit it answers my_data() itself;
-- past it {"status": "wait", "retry_at": time}.
-- ---------------------------------------------------------------------------------------------------------------

create table public.data_downloads (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index data_downloads_user on public.data_downloads (user_id, at);
revoke all on public.data_downloads from anon, authenticated;
alter table public.data_downloads enable row level security;

create function public.data_download_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"gap_seconds": 60, "a_day": 5}'::jsonb
$$;

create function public.download_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.data_download_limits();
  gap interval := make_interval(secs => (lim->>'gap_seconds')::integer);
  last timestamptz;
  oldest timestamptz;
  n integer;
begin
  if me is null then
    return null;
  end if;
  -- One at a time a person: a second call waits here, then finds the first one's time.
  perform 1 from public.profiles where id = me for update;
  delete from public.data_downloads where user_id = me and at < now() - interval '1 day';
  select max(at), min(at), count(*) into last, oldest, n from public.data_downloads where user_id = me;
  if last is not null and (last > now() - gap or n >= (lim->>'a_day')::integer) then
    return jsonb_build_object('status', 'wait', 'retry_at',
      greatest(last + gap, case when n >= (lim->>'a_day')::integer then oldest + interval '1 day' end));
  end if;
  insert into public.data_downloads (user_id) values (me);
  return public.my_data();
end $$;

-- Download my data's part: when the person downloaded it in the last day (kept a day, for the limit).
create function public.my_data_part_data_downloads() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('data_downloads', coalesce(jsonb_agg(d.at order by d.at), '[]'::jsonb))
  from public.data_downloads d where d.user_id = auth.uid() and d.at >= now() - interval '1 day'
$$;

revoke all on function public.data_download_limits(), public.download_my_data(), public.my_data_part_data_downloads() from public, anon, authenticated;
grant execute on function public.download_my_data() to authenticated;
revoke all on function public.my_data() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Print log (20261113120000_print_log.sql): grams kept to at most three decimals (a milligram; the app sends 0.1 g),
-- both in the check every save makes and on the table. A number of any length was kept before.
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.print_log_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  lim jsonb := public.print_log_limits();
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('id', 'made_at', 'name', 'settings', 'grams', 'minutes', 'result', 'problem', 'note', 'updated_at')) then return false; end if;
  if jsonb_typeof(p->'id') is distinct from 'string' or (p->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(p->'made_at') is distinct from 'string' or public.print_log_time(p->>'made_at') is null then return false; end if;
  if jsonb_typeof(p->'updated_at') is distinct from 'string' or public.print_log_time(p->>'updated_at') is null then return false; end if;
  if jsonb_typeof(p->'name') is distinct from 'string' or char_length(p->>'name') not between 1 and (lim->>'max_name')::integer then return false; end if;
  if jsonb_typeof(p->'settings') is distinct from 'string' or char_length(p->>'settings') > (lim->>'max_settings')::integer then return false; end if;
  if jsonb_typeof(p->'note') is distinct from 'string' or char_length(p->>'note') > (lim->>'max_note')::integer then return false; end if;
  if coalesce(jsonb_typeof(p->'grams'), 'null') not in ('null', 'number') then return false; end if;
  if jsonb_typeof(p->'grams') = 'number' and pg_catalog.scale((p->>'grams')::numeric) > 3 then return false; end if;
  if jsonb_typeof(p->'grams') = 'number' and (p->>'grams')::numeric not between 0 and 100000 then return false; end if;
  if coalesce(jsonb_typeof(p->'minutes'), 'null') not in ('null', 'number') then return false; end if;
  if jsonb_typeof(p->'minutes') = 'number' and (p->>'minutes') !~ '^[0-9]{1,6}$' then return false; end if;
  if jsonb_typeof(p->'minutes') = 'number' and (p->>'minutes')::integer > 100000 then return false; end if;
  if jsonb_typeof(p->'result') is distinct from 'string' or (p->>'result') not in ('waiting', 'well', 'failed') then return false; end if;
  if coalesce(jsonb_typeof(p->'problem'), 'null') not in ('null', 'string') then return false; end if;
  if jsonb_typeof(p->'problem') = 'string' and ((p->>'result') <> 'failed' or (p->>'problem') not in ('came-off', 'warped', 'stringing', 'layer-shift', 'spaghetti', 'supports', 'gaps', 'wrong-size', 'stopped', 'other')) then return false; end if;
  return true;
end $$;
update public.print_log set grams = round(grams, 3) where pg_catalog.scale(grams) > 3;
alter table public.print_log add constraint print_log_grams_three_decimals check (pg_catalog.scale(grams) <= 3);

-- ---------------------------------------------------------------------------------------------------------------
-- Report a bug (20261111000000_bug_reports.sql): its id sequence was still open to the browser's roles, so a setval
-- to its end would stop every later report. Closed, as shares' is.
-- ---------------------------------------------------------------------------------------------------------------

revoke all on sequence public.bug_report_log_id_seq from public, anon, authenticated;
