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

-- Words no name may be, begin or end with (a word inside a name, as "admin" in "badminton", is fine), or, marked
-- `anywhere`, hold at all ("TheSpindleLabsTeam"). Compared folded, as names are (display_name_key), so "Adm1n" is
-- "admin". Kept by the server; the browser never reads it, so the list can't be used to find a way round it.
-- PLACEHOLDER: only names that pass as SpindleLabs itself for now; C5 adds the rest.
create table public.blocked_name_words (
  word text primary key check (word ~ '^[a-z]+$'),
  anywhere boolean not null default false
);
revoke all on public.blocked_name_words from anon, authenticated;
alter table public.blocked_name_words enable row level security;
insert into public.blocked_name_words (word, anywhere) values ('spindlelabs', true), ('spindle', false), ('admin', false), ('moderator', false), ('official', false), ('support', false);

create function public.display_name_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('min_length', 3, 'max_length', 30, 'change_gap_seconds', 604800)
$$;

-- The key a name is compared by, so look-alikes are one name (security review 2026-11-11; a short form of the
-- Unicode confusables "skeleton", UTS #39): accents off (NFKD, then the combining marks dropped), lower case,
-- letters and digits only, then the Cyrillic and Greek letters that look like Latin ones turned into those, and
-- the digits and letters people swap for each other: 0 -> o, 1 and i -> l, 3 -> e, 4 -> a, 5 -> s.
-- "Ben_P.3D" -> "benped"; "Zoë" -> "zoe"; "Spind1eLabs" and "SpindIeLabs" -> "spindlelabs".
create function public.display_name_key(p_name text) returns text
language sql immutable set search_path = '' as $$
  select translate(
    translate(lower(regexp_replace(regexp_replace(normalize(p_name, NFKD), '[\u0300-\u036f]', '', 'g'), '[^[:alnum:]]', '', 'g')),
      'аеорсухіјѕԁһкмнтвοαειινρτυχκ', 'aeopcyxijsdhkmhtboaeiivptuxk'),
    '01345i', 'oleasl')
$$;

-- The writing system of each letter of a name, by its code point: a name may use only one, so it can't mix Latin
-- with look-alike letters from another (Han and the Japanese kana count as one, as Japanese mixes them). Letters
-- outside these are refused for now.
create function public.display_name_script_ok(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  with letters as (
    select case
      when c between 'a' and 'z' or c between 'A' and 'Z' or ascii(c) between 192 and 591 or ascii(c) between 7680 and 7935 then 'latin'
      when ascii(c) between 880 and 1023 then 'greek'
      when ascii(c) between 1024 and 1327 then 'cyrillic'
      when ascii(c) between 1328 and 1423 then 'armenian'
      when ascii(c) between 1424 and 1535 then 'hebrew'
      when ascii(c) between 1536 and 1791 then 'arabic'
      when ascii(c) between 2304 and 2431 then 'devanagari'
      when ascii(c) between 3584 and 3711 then 'thai'
      when ascii(c) between 4352 and 4607 or ascii(c) between 44032 and 55215 then 'hangul'
      when ascii(c) between 12352 and 12543 or ascii(c) between 19968 and 40959 then 'japanese-chinese'
      else 'other' end as script
    from regexp_split_to_table(p_name, '') c where c ~ '[[:alpha:]]')
  select count(distinct script) <= 1 and not bool_or(script = 'other') is true from letters
$$;

-- Sets the person's display name. Answers, never raising for these:
--   "saved"     the name is theirs now (setting the name they already have changes nothing and says "saved")
--   "bad"       not 3 to 30 characters, characters other than letters, digits 0-9, spaces, _ - and ., not starting
--               and ending with a letter or digit, two spaces in a row, fewer than 3 letters and digits, a form that
--               normalising would change (full-width letters, ligatures), or letters from two writing systems
--   "blocked"   it is, begins or ends with a word no name may, or holds one marked anywhere (blocked_name_words)
--   "taken"     someone else has this name, compared as display_name_key folds it (look-alikes are one name)
--   "held"      the account is held by moderation (20261111140000_moderation.sql)
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
     or p_name !~ '^[[:alnum:]]([[:alnum:] _.-]*[[:alnum:]])?$' or p_name ~ '  '
     or p_name <> normalize(p_name, NFKC) or regexp_replace(p_name, '[0-9[:alpha:] _.-]', '', 'g') <> ''
     -- digits other than 0-9 (this database counts some, such as Arabic-Indic ones, as letters)
     or p_name ~ '[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f\u0e50-\u0e59]'
     or not public.display_name_script_ok(p_name) then
    return 'bad';
  end if;
  key := public.display_name_key(p_name);
  if char_length(key) < (lim->>'min_length')::integer then
    return 'bad';
  end if;
  if exists (select from public.blocked_name_words w, lateral (select public.display_name_key(w.word) as k) f
             where key = f.k or starts_with(key, f.k) or right(key, char_length(f.k)) = f.k or (w.anywhere and position(f.k in key) > 0)) then
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
  when raise_exception then
    -- A hold on the account (moderation, a later migration) refuses the row where it is written.
    if sqlerrm = 'account held' then
      return 'held';
    end if;
    raise;
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

revoke all on function public.display_name_limits(), public.display_name_key(text), public.display_name_script_ok(text), public.set_display_name(text), public.my_display_name(), public.reset_display_name(uuid), public.my_data_part_display_name() from public, anon, authenticated;
grant execute on function public.display_name_limits(), public.display_name_key(text) to anon, authenticated;
grant execute on function public.set_display_name(text), public.my_display_name() to authenticated;
grant execute on function public.reset_display_name(uuid) to service_role;
