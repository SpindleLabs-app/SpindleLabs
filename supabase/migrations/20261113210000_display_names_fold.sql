-- Display names compared by Unicode's look-alike list (security hunt 2026-11-13, private bug-reports#4 B5). The first
-- key (20261111130000_display_names.sql, not edited: it is applied on the live project) folded accents and a short
-- table of Cyrillic and Greek letters, so Latin letters with no accent to strip (dotless i, o and d and l with a stroke,
-- the dental click that looks like l) and Greek capitals such as beta, eta and mu kept their own key: "Admın" passed as
-- staff and "ΒΟΒ" as Bob. Decided 2026-11-13 (the coordinator, under Ben's rule): fold by Unicode's own data.
--
-- display_name_key now: NFKD, combining marks dropped, then every letter that Unicode's confusables data (UTS #39,
-- confusables.txt, as bundled by the MIT package confusable_homoglyphs 3.3.1) says looks like a plain letter or digit
-- written as that letter, then lower case, letters and digits only, then the first key's folds (its Cyrillic and Greek
-- table, and 0 -> o, 1 and i -> l, 3 -> e, 4 -> a, 5 -> s), so no two names the first key called one are told apart now.
-- Letters of real names that look like no single plain letter are written as people write them without the letter:
-- ß ss, þ th, ð d, ŋ n, ĸ k (and wynn ƿ as p). The table below is generated from that data; to change it, regenerate it
-- rather than editing by hand. A Latin name whose key is still not plain a-z and 0-9 is refused (set_display_name "bad").
-- Names saved before are keyed again once (rekey_display_names): the oldest keeps a key, and a later name that is now
-- the same as an earlier one, or holds a blocked word, is taken away as a moderator would (they pick again at once),
-- in the moderation record. supabase/test/test_display_names_fold.py checks all of this.

create or replace function public.display_name_key(p_name text) returns text
language sql immutable set search_path = '' as $$
  select translate(
    translate(lower(regexp_replace((select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(translate(s, 'ÐØðøĐđĦħıĸŁłŊŋŦŧƀƂƃƄƉƌƍƑƒƖƗƙƚƝƞƟƥƦƧƭƮƴƵƶƷƻƼƽƿǀǤǥǷȜȢȣȤȥȼȾɄɆɇɈɉɍɎɏͿΑΒΕΖΗΘΙΚΜΝΟΡΤΥΧαγηθινορσυϜϨϳϺЅІЈАБВЕЗКМНОРСТУХЬабгеорсухѕіјћѡѢѣѲѳѴѵҌҍғҘҚҞҢҪҫҬҮүҰұҲһҽҿӀӇӉӍӏӠӨөԁԌԛԜԝՍՏՕագզհոռսցքօוטןסاهھہەۿẝỿ', 'DOdoDdHhikLlNnTtbbbbDdgFfllklNnOpR2tTyZz325splGgP388ZzcTUEeJjrYyJABEZHOlKMNOPTYXaynOivopouF2jMSlJAbBE3KMHOPCTYXba6reopcyxsijhwbbOoVvbbr3KKHCcTYyYyXheelHHMi3OodGqWwUSOwqqhnnugfolvlolooooofy'), 'Æ', 'AE'), 'Þ', 'TH'), 'ß', 'ss'), 'æ', 'ae'), 'þ', 'th'), 'Œ', 'OE'), 'œ', 'oe'), 'ǁ', 'll'), 'Ы', 'bl'), 'Ю', 'lO'), 'Ӕ', 'AE'), 'ӕ', 'ae'), 'װ', 'll'), 'ẞ', 'SS')
                                     from (select regexp_replace(normalize(p_name, NFKD), '[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]', '', 'g') as s) x),
                                    '[^[:alnum:]]', '', 'g')),
      'аеорсухіјѕԁһкмнтвοαειινρτυχκ', 'aeopcyxijsdhkmhtboaeiivptuxk'),
    '01345i', 'oleasl')
$$;

-- Whether a key is, begins or ends with a blocked word, or holds one marked anywhere (as set_display_name has checked).
create function public.display_name_blocked(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select from public.blocked_name_words w, lateral (select public.display_name_key(w.word) as k) f
                 where p_key = f.k or starts_with(p_key, f.k) or right(p_key, char_length(f.k)) = f.k or (w.anywhere and position(f.k in p_key) > 0))
$$;

-- As in 20261111130000_display_names.sql (the comment there lists the answers), with the Latin check on the key.
create or replace function public.set_display_name(p_name text) returns text
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
  -- A Latin name's key must be plain a-z and 0-9: a Latin letter that looks like no plain letter is refused.
  if char_length(key) < (lim->>'min_length')::integer or (p_name ~ '[\u00c0-\u024f\u1e00-\u1eff]' and key !~ '^[a-z0-9]+$') then
    return 'bad';
  end if;
  if public.display_name_blocked(key) then
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

-- Keys every saved name again, oldest first: a name whose new key is blocked, or the same as an older name's, is taken
-- away and recorded as reset-name. Server only. Answers how many were taken away.
create function public.rekey_display_names() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.display_names;
  k text;
  done uuid[] := '{}';
  holder uuid;
  gone integer := 0;
begin
  for r in select * from public.display_names order by changed_at, user_id loop
    if not exists (select from public.display_names where user_id = r.user_id) then
      continue; -- taken away above, as a newer name holding a key an older one now has
    end if;
    k := public.display_name_key(r.name);
    select d.user_id into holder from public.display_names d where d.name_key = k and d.user_id <> r.user_id;
    if public.display_name_blocked(k) or holder = any(done) then
      delete from public.display_names where user_id = r.user_id;
      insert into public.moderation_log (action, user_id, moderator, note)
      values ('reset-name', r.user_id, 'SpindleLabs (automatic)', 'Look-alike names rule of 2026-11-13: this name looks like an older one, or like a blocked word.');
      gone := gone + 1;
      continue;
    end if;
    if holder is not null then
      -- A newer name holds this key under the old rule: the older one keeps it.
      delete from public.display_names where user_id = holder;
      insert into public.moderation_log (action, user_id, moderator, note)
      values ('reset-name', holder, 'SpindleLabs (automatic)', 'Look-alike names rule of 2026-11-13: this name looks like an older one, or like a blocked word.');
      gone := gone + 1;
    end if;
    update public.display_names set name_key = k where user_id = r.user_id;
    done := done || r.user_id;
  end loop;
  return gone;
end $$;

revoke all on function public.display_name_blocked(text), public.rekey_display_names() from public, anon, authenticated;
grant execute on function public.rekey_display_names() to service_role;

select public.rekey_display_names();
