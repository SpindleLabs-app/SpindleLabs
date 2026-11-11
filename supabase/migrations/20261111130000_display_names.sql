-- Profiles, first piece (community step C6): a display name, and nothing else. No real names, pictures of people,
-- locations or messages: the community is used by students (the owner is one), so a profile is only the name shown
-- beside a person's shared designs, picked by them. Nothing shows it yet; the public library (C3) will, through a
-- function added then. The word list is a PLACEHOLDER until the moderation step (C5) and the legal check.
--
-- Two names that differ only in capitals, spaces or punctuation are the same name ("Ben_P" and "ben p" both
-- "benp"), so nobody can pass as somebody else that way. A name can be changed once a week, so it can't be used to
-- dodge reports. supabase/test/test_display_names.py checks every rule here against a real PostgreSQL.

create table public.display_names (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  -- The name as compared: lower case, letters and digits only. Unique, so no two people share a name.
  name_key text not null unique,
  changed_at timestamptz not null default now()
);

revoke all on public.display_names from anon, authenticated;
alter table public.display_names enable row level security;
-- Reading is through the functions below; this policy is the second lock behind them, should a grant ever be added.
create policy "own name only" on public.display_names for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Words no name may begin or end with, or be (compared against name_key; a word inside a name, as "admin" in
-- "badminton", is fine). Kept by the server; the browser never reads it, so the
-- list can't be used to find a way round it. PLACEHOLDER: only names that pass as SpindleLabs itself for now; C5
-- adds the rest.
create table public.blocked_name_words (
  word text primary key check (word ~ '^[[:lower:][:digit:]]+$')
);
revoke all on public.blocked_name_words from anon, authenticated;
alter table public.blocked_name_words enable row level security;
insert into public.blocked_name_words (word) values ('spindlelabs'), ('spindle'), ('admin'), ('moderator'), ('official'), ('support');

create function public.display_name_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('min_length', 3, 'max_length', 30, 'change_gap_seconds', 604800)
$$;

-- The key a name is compared by: lower case, letters and digits only.
create function public.display_name_key(p_name text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(p_name, '[^[:alnum:]]', '', 'g'))
$$;

-- Sets the person's display name. Answers, never raising for these:
--   "saved"     the name is theirs now (setting the name they already have changes nothing and says "saved")
--   "bad"       not 3 to 30 characters, characters other than letters, digits, spaces, _ - and ., not starting and
--               ending with a letter or digit, two spaces in a row, or fewer than 3 letters and digits
--   "blocked"   it is, begins or ends with a word no name may (blocked_name_words)
--   "taken"     someone else has this name (compared without capitals, spaces or punctuation)
--   "too-soon"  the person changed their name less than a week ago
create function public.set_display_name(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.display_name_limits();
  key text;
  mine public.display_names;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if p_name is null or char_length(p_name) < (lim->>'min_length')::integer or char_length(p_name) > (lim->>'max_length')::integer
     or p_name !~ '^[[:alnum:]]([[:alnum:] _.-]*[[:alnum:]])?$' or p_name ~ '  ' then
    return 'bad';
  end if;
  key := public.display_name_key(p_name);
  if char_length(key) < (lim->>'min_length')::integer then
    return 'bad';
  end if;
  if exists (select from public.blocked_name_words w where key = w.word or starts_with(key, w.word) or right(key, char_length(w.word)) = w.word) then
    return 'blocked';
  end if;
  select * into mine from public.display_names where user_id = me for update;
  if found and mine.name = p_name then
    return 'saved';
  end if;
  if found and mine.changed_at > now() - make_interval(secs => (lim->>'change_gap_seconds')::integer) then
    return 'too-soon';
  end if;
  if exists (select from public.display_names d where d.name_key = key and d.user_id <> me) then
    return 'taken';
  end if;
  begin
    insert into public.display_names (user_id, name, name_key) values (me, p_name, key)
      on conflict (user_id) do update set name = excluded.name, name_key = excluded.name_key, changed_at = now();
  exception when unique_violation then
    return 'taken'; -- someone else took it between the check above and now
  end;
  return 'saved';
end $$;

-- The person's display name, when it last changed and when it may change next; null when they have none.
create function public.my_display_name() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', d.name, 'changed_at', d.changed_at,
    'next_change_at', d.changed_at + make_interval(secs => (public.display_name_limits()->>'change_gap_seconds')::integer))
  from public.display_names d where d.user_id = auth.uid()
$$;

-- Takes a person's display name away (server only, for moderation until C5's review list): they pick a new one,
-- which they may do at once.
create function public.reset_display_name(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.display_names where user_id = p_user;
  return found;
end $$;

-- Profiles' part of Download my data.
create function public.my_data_part_display_name() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('display_name', public.my_display_name())
$$;

revoke all on function public.display_name_limits(), public.display_name_key(text), public.set_display_name(text), public.my_display_name(), public.reset_display_name(uuid), public.my_data_part_display_name() from public, anon, authenticated;
grant execute on function public.display_name_limits(), public.display_name_key(text) to anon, authenticated;
grant execute on function public.set_display_name(text), public.my_display_name() to authenticated;
grant execute on function public.reset_display_name(uuid) to service_role;
