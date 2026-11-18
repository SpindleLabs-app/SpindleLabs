-- Friends by profile ID (account features 6). A signed-in person who turns Friends on gets a random profile ID
-- ("7KX2M-QD9TA"), which they give to whoever they choose. Nobody can search for, list or be suggested people: the
-- only way to reach someone is to type their exact ID, and a person who never turns Friends on has no ID at all.
-- A request shows the asker's display name and nothing else; the person asked accepts, declines (the asker is never
-- told) or blocks. Friends see each other's display name and the day they became friends; never an email, a real
-- name, a picture, an ID or anything else. Nothing uses friends yet beyond the list: later features (sharing with
-- friends) will, each with its own privacy wording first.
--
-- The browser never touches these tables: every read and change is a function below, checking who is asking.
-- supabase/test/test_friends.py checks every rule here on a real PostgreSQL.

-- A person's profile ID: having one means Friends is on. Ten characters from Crockford's base 32 (digits and capitals
-- without I, L, O and U, so it reads aloud and types without mix-ups): 32^10, about 10^15 IDs, against at most 20
-- tries a day each person, so guessing someone's is hopeless.
create table public.friend_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[0-9A-HJKMNP-TV-Z]{10}$'),
  made_at timestamptz not null default now()
);

-- A request from one person to another. `code` is the ID the asker typed, which is what the asker's list shows until
-- the other person accepts (never their name: typing an ID must not tell you whose it is). A declined request stays,
-- marked, so the asker can't simply ask again; it shows to the asker as still waiting. Every request goes after 30
-- days.
create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  code text not null,
  sent_at timestamptz not null default now(),
  declined boolean not null default false,
  unique (from_user, to_user),
  check (from_user <> to_user)
);
create index friend_requests_to on public.friend_requests (to_user);

-- Two friends, kept once with the smaller id first.
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references auth.users (id) on delete cascade,
  b uuid not null references auth.users (id) on delete cascade,
  since timestamptz not null default now(),
  unique (a, b),
  check (a < b)
);
create index friendships_b on public.friendships (b);

-- A block: `blocked` can never become `blocker`'s friend, and `blocker` never sees their requests. The blocked person
-- is not told. Kept while Friends is off, so a block still holds if it is turned on again.
create table public.friend_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  made_at timestamptz not null default now(),
  unique (blocker, blocked),
  check (blocker <> blocked)
);

-- When a person last typed an ID to send a request, for the daily limit; kept one day.
create table public.friend_tries (
  user_id uuid not null references auth.users (id) on delete cascade,
  tried_at timestamptz not null default now()
);
create index friend_tries_user on public.friend_tries (user_id, tried_at);

revoke all on public.friend_codes, public.friend_requests, public.friendships, public.friend_blocks, public.friend_tries from anon, authenticated;
alter table public.friend_codes enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_blocks enable row level security;
alter table public.friend_tries enable row level security;
-- Reading is through the functions below; these policies are the second lock behind them, should a grant ever be
-- added: a person's own rows only, never the other person's side.
create policy "own code only" on public.friend_codes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own requests only" on public.friend_requests for all to authenticated using (from_user = auth.uid()) with check (from_user = auth.uid());
create policy "own friendships only" on public.friendships for select to authenticated using (a = auth.uid() or b = auth.uid());
create policy "own blocks only" on public.friend_blocks for all to authenticated using (blocker = auth.uid()) with check (blocker = auth.uid());
create policy "own tries only" on public.friend_tries for select to authenticated using (user_id = auth.uid());

-- The limits, in one place so the app and the tests read the same numbers: 200 friends, 20 requests waiting at once,
-- 20 IDs typed a day, requests kept 30 days, the ID's 10 characters.
create function public.friends_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('max_friends', 200, 'max_waiting', 20, 'tries_a_day', 20, 'request_days', 30, 'code_length', 10)
$$;

-- A new random ID. Each of ten bytes of a random UUID that are wholly random (not its version or variant bytes)
-- picks one of the 32 characters: 256 is 8 × 32, so each character is equally likely.
create function public.friend_code_new() returns text
language plpgsql volatile set search_path = '' as $$
declare
  b bytea := uuid_send(gen_random_uuid());
  alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  result text := '';
  i integer;
begin
  foreach i in array array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12] loop
    result := result || substr(alphabet, get_byte(b, i) % 32 + 1, 1);
  end loop;
  return result;
end $$;

-- An ID as typed, the way it is kept, or null when it can't be one: spaces and dashes dropped, capitals, and the
-- letters people type for digits (O for 0, I and L for 1) read as those digits.
create function public.friend_code_key(p_text text) returns text
language sql immutable set search_path = '' as $$
  select case when k ~ '^[0-9A-HJKMNP-TV-Z]{10}$' then k end
  from (select translate(upper(regexp_replace(coalesce(p_text, ''), '[\s-]', '', 'g')), 'OIL', '011') as k) t
$$;

-- Gives the person a fresh ID, trying again in the (vanishingly unlikely) case another person has it.
create function public.friend_code_give(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  fresh text;
begin
  loop
    fresh := public.friend_code_new();
    begin
      insert into public.friend_codes (user_id, code) values (p_user, fresh)
        on conflict (user_id) do update set code = excluded.code, made_at = now();
      return fresh;
    exception when unique_violation then
      -- another person's ID: draw again
    end;
  end loop;
end $$;

-- Requests over 30 days old, and tries over a day old, of this person, deleted (each function does this first, so
-- nothing older is ever seen or counted).
create function public.friends_tidy(p_user uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.friend_requests where (from_user = p_user or to_user = p_user)
    and sent_at < now() - make_interval(days => (public.friends_limits()->>'request_days')::integer);
  delete from public.friend_tries where user_id = p_user and tried_at < now() - interval '1 day';
$$;

create function public.friend_count(p_user uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.friendships where a = p_user or b = p_user
$$;

-- Makes two people friends (nothing when they are already), deleting the requests between them.
create function public.friends_join(p_one uuid, p_two uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.friend_requests where (from_user = p_one and to_user = p_two) or (from_user = p_two and to_user = p_one);
  insert into public.friendships (a, b) values (least(p_one, p_two), greatest(p_one, p_two)) on conflict (a, b) do nothing;
$$;

-- Everything Friends shows the person: {"on": bool, "code": "7KX2MQD9TA" or null, "friends": [{id, name, since}],
-- "asking_me": [{id, name, sent_at}], "i_asked": [{id, code, sent_at}], "blocked": [{id, name, since}],
-- "tries_left": n}. Names are display names (null when the person has none now). Newest first. Ids are those of
-- the friendship, request or block, never a person's account ID. Reads only (Download my data uses it too); requests
-- over 30 days old and tries over a day old are left out here as well as deleted by friends_tidy.
create function public.friends_shown(p_user uuid) returns jsonb
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
      from public.friend_requests r where r.from_user = p_user and r.sent_at >= fresh), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', d.name, 'since', k.made_at) order by k.made_at desc, k.id)
      from public.friend_blocks k left join public.display_names d on d.user_id = k.blocked where k.blocker = p_user), '[]'::jsonb),
    'tries_left', greatest(0, (lim->>'tries_a_day')::integer
      - (select count(*)::integer from public.friend_tries t where t.user_id = p_user and t.tried_at >= now() - interval '1 day')));
end $$;

create function public.my_friends() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  perform public.friends_tidy(me);
  return public.friends_shown(me);
end $$;

-- Turns Friends on or off for the person. Answers, never raising for these:
--   "on"       on, with an ID (already on: the same ID)
--   "off"      off: their ID, friends and every request to or from them are deleted; their blocks stay
--   "no-name"  turning on needs a display name, since that is what a request and a friend's list show
--   "held"     the account is held by moderation, so it can't turn on
create function public.set_friends(p_on boolean) returns text
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
    delete from public.friend_requests where from_user = me or to_user = me;
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

-- A fresh ID in place of the old one, which stops working at once (requests already sent stay). Null when Friends
-- is off.
create function public.new_friend_code() returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if not exists (select from public.friend_codes where user_id = me) then
    return null;
  end if;
  return public.friend_code_give(me);
end $$;

-- Asks the person whose ID is p_code to be friends. Answers, never raising for these:
--   "sent"      asked (also when that person blocked the asker: a block is never told)
--   "friends"   they had already asked the asker, so now they are friends
--   "waiting"   the asker asked them already and it hasn't been answered
--   "already"   they are friends already
--   "self"      the asker's own ID
--   "not-found" nobody has this ID now
--   "bad"       not an ID (counts as no try)
--   "blocked"   the asker blocked them: unblock first
--   "off"       the asker hasn't turned Friends on
--   "held"      the asker's account is held by moderation
--   "too-many"  20 IDs typed in the last day
--   "full"      the asker (or, to become friends now, either of them) has 200 friends, or 20 requests waiting
create function public.send_friend_request(p_code text) returns text
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
  if exists (select from public.friend_requests where from_user = me and to_user = them) then
    return 'waiting';
  end if;
  -- They asked first (and haven't blocked the asker): asking back is a yes.
  if exists (select from public.friend_requests where from_user = them and to_user = me)
     and not exists (select from public.friend_blocks where blocker = them and blocked = me) then
    if public.friend_count(me) >= (lim->>'max_friends')::integer or public.friend_count(them) >= (lim->>'max_friends')::integer then
      return 'full';
    end if;
    perform public.friends_join(me, them);
    return 'friends';
  end if;
  if public.friend_count(me) >= (lim->>'max_friends')::integer
     or (select count(*) from public.friend_requests where from_user = me) >= (lim->>'max_waiting')::integer then
    return 'full';
  end if;
  insert into public.friend_requests (from_user, to_user, code) values (me, them, key);
  return 'sent';
end $$;

-- Accepts a request to the person (by its id). Answers "friends", "gone" (no such request to them, declined, from
-- someone they blocked, or Friends is off) or "full" (either has 200 friends).
create function public.accept_friend_request(p_id uuid) returns text
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
  if public.friend_count(me) >= (lim->>'max_friends')::integer or public.friend_count(them) >= (lim->>'max_friends')::integer then
    return 'full';
  end if;
  perform public.friends_join(me, them);
  return 'friends';
end $$;

-- Declines a request to the person: it leaves their list; the asker still sees it waiting until it goes after 30
-- days, and can't ask again before then. True when there was one.
create function public.decline_friend_request(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  update public.friend_requests set declined = true where id = p_id and to_user = auth.uid() and not declined;
  return found;
end $$;

-- Takes back a request the person sent. True when there was one.
create function public.cancel_friend_request(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.friend_requests where id = p_id and from_user = auth.uid();
  return found;
end $$;

-- Ends a friendship of the person (by its id); the other person is not told, the friend simply goes from both lists.
create function public.remove_friend(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.friendships where id = p_id and (a = auth.uid() or b = auth.uid());
  return found;
end $$;

-- Blocks the other person of a friendship or of a request to the person (by its id): the friendship and every
-- request between them go, and that person can never be their friend or show in their requests until unblocked.
-- The blocked person is not told. True when p_id was one of these.
create function public.block_friend(p_id uuid) returns boolean
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
  delete from public.friend_requests where (from_user = me and to_user = them) or (from_user = them and to_user = me);
  return true;
end $$;

-- Takes a block away (by its id). Requests that person sent while blocked are deleted, never shown. True when there
-- was one.
create function public.unblock_friend(p_id uuid) returns boolean
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
  delete from public.friend_requests where from_user = them and to_user = me;
  return true;
end $$;

-- Download my data's part (see my_data in 20261105120000_my_designs.sql): the person's ID, friends, requests both
-- ways and blocks, as my_friends shows them, plus when the ID was made and the IDs typed in the last day.
create function public.my_data_part_friends() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  shown jsonb;
begin
  if me is null then
    return '{}'::jsonb;
  end if;
  shown := public.friends_shown(me);
  return jsonb_build_object('friends', jsonb_build_object(
    'profile_id', shown->'code',
    'profile_id_made_at', (select made_at from public.friend_codes where user_id = me),
    'friends', shown->'friends',
    'asking_me', shown->'asking_me',
    'i_asked', shown->'i_asked',
    'blocked', shown->'blocked',
    'ids_typed_last_day', coalesce((select jsonb_agg(t.tried_at order by t.tried_at) from public.friend_tries t where t.user_id = me and t.tried_at >= now() - interval '1 day'), '[]'::jsonb)));
end $$;

revoke all on function public.friends_limits(), public.friend_code_new(), public.friend_code_key(text), public.friend_code_give(uuid), public.friends_tidy(uuid), public.friend_count(uuid), public.friends_join(uuid, uuid), public.friends_shown(uuid), public.my_friends(), public.set_friends(boolean), public.new_friend_code(), public.send_friend_request(text), public.accept_friend_request(uuid), public.decline_friend_request(uuid), public.cancel_friend_request(uuid), public.remove_friend(uuid), public.block_friend(uuid), public.unblock_friend(uuid), public.my_data_part_friends() from public, anon, authenticated;
grant execute on function public.friends_limits(), public.my_friends(), public.set_friends(boolean), public.new_friend_code(), public.send_friend_request(text), public.accept_friend_request(uuid), public.decline_friend_request(uuid), public.cancel_friend_request(uuid), public.remove_friend(uuid), public.block_friend(uuid), public.unblock_friend(uuid) to authenticated;
