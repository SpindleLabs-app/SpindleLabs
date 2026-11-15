-- The public library's space and search limits, after the 2026-11-13 security hunt (private bug-reports#4, B4 and B6).
-- Nothing in 20261112030000_library.sql is edited (it is applied on the live project); the functions below replace
-- theirs.
--
-- B4: the 50 MiB of a person's files was only added up in finish_publish, so files uploaded and never finished were
-- never counted: one account could fill the bucket by 50 MiB a day. Now the space is checked where the bytes arrive:
--   - begin_publish answers "full" when the person's files in the bucket, plus max_file_bytes for each entry of theirs
--     still waiting for its file, already pass max_bytes;
--   - Storage's upload policy (library_may_upload) refuses an upload once the person's files pass max_bytes.
-- So one account holds at most max_bytes and the one file that crossed it (55 MiB), whatever it does.
-- B6: browse_library worked the search text out again for every entry it looked at, and took text of any length; a
-- signed-out search of 200 KB cost tens of seconds. Now a search over max_search characters (or a tag over max_tag)
-- finds nothing, and the search is worked out once.
-- supabase/test/test_library.py checks both, with 0.9x/1.1x of each limit.

create or replace function public.library_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('max_entries', 50, 'max_bytes', 52428800, 'max_file_bytes', 5242880, 'max_picture_bytes', 32768,
                            'entries_per_day', 10, 'max_title', 100, 'max_description', 2000, 'max_tags', 8, 'max_tag', 24,
                            'upload_minutes', 60, 'page', 48, 'max_search', 200,
                            'licences', jsonb_build_array('CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC0-1.0'))
$$;

-- The bytes of every file of the person's in the bucket, whatever the entry's state.
create function public.library_bytes_of(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(public.library_file_bytes(e.id)), 0)::bigint from public.library_entries e where e.user_id = p_user
$$;

create or replace function public.library_may_upload(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select from public.library_entries e
                 where e.id = public.library_entry_of(p_name) and e.user_id = auth.uid() and e.state = 'uploading'
                   and e.created_at > now() - make_interval(mins => (public.library_limits()->>'upload_minutes')::integer))
         and public.sharing_on() and not public.account_held(auth.uid())
         and public.library_bytes_of(auth.uid()) <= (public.library_limits()->>'max_bytes')::bigint
$$;

-- As in 20261112030000_library.sql, with the space check (the comment there lists the answers).
create or replace function public.begin_publish(p_title text, p_description text, p_licence text, p_tags text[], p_picture text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.library_limits();
  new_id uuid;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if not public.sharing_on() then
    return jsonb_build_object('status', 'off');
  end if;
  if p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) = 0 or pg_catalog.char_length(p_title) > (lim->>'max_title')::integer
     or p_title <> pg_catalog.btrim(p_title)
     or p_description is null or pg_catalog.char_length(p_description) > (lim->>'max_description')::integer
     or p_licence is null or not (lim->'licences') ? p_licence
     or not public.library_tags_ok(p_tags)
     or (p_picture is not null and (p_picture !~ '^data:image/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
                                    or pg_catalog.octet_length(p_picture) > (lim->>'max_picture_bytes')::integer)) then
    return jsonb_build_object('status', 'bad');
  end if;
  -- The person's lock first, so two tabs publishing at once can't both get the last place.
  perform 1 from public.profiles where id = me for update;
  perform public.library_close_stale(me);
  if (select count(*) from public.library_entries where user_id = me and state in ('live', 'uploading')) >= (lim->>'max_entries')::integer then
    return jsonb_build_object('status', 'full');
  end if;
  -- Every file in the bucket counts, live or not, and each entry still waiting for its file counts as the largest file.
  if public.library_bytes_of(me)
     + (lim->>'max_file_bytes')::bigint * (select count(*) from public.library_entries e
                                            where e.user_id = me and e.state = 'uploading' and public.library_file_bytes(e.id) is null)
     > (lim->>'max_bytes')::bigint then
    return jsonb_build_object('status', 'full');
  end if;
  if (select count(*) from public.library_entries where user_id = me and created_at > now() - interval '24 hours') >= (lim->>'entries_per_day')::integer then
    return jsonb_build_object('status', 'daily');
  end if;
  begin
    insert into public.library_entries (user_id, title, description, licence, tags, picture, search)
    values (me, p_title, p_description, p_licence, p_tags, p_picture, public.library_search_text(p_title, p_description, p_tags))
    returning id into new_id;
  exception when raise_exception then
    if sqlerrm = 'account held' then
      return jsonb_build_object('status', 'held');
    end if;
    raise;
  end;
  return jsonb_build_object('status', 'ready', 'id', new_id, 'file', public.library_file_name(new_id));
end $$;

-- As in 20261112030000_library.sql (anyone, newest first, words and a tag, a page after a cursor; null while sharing
-- is off), with the search text's length capped and the search worked out once.
create or replace function public.browse_library(p_search text, p_tag text, p_before timestamptz, p_before_id uuid, p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  lim jsonb := public.library_limits();
  q tsquery;
begin
  if not public.sharing_on() then
    return null;
  end if;
  if pg_catalog.char_length(coalesce(p_search, '')) > (lim->>'max_search')::integer
     or pg_catalog.char_length(coalesce(p_tag, '')) > (lim->>'max_tag')::integer then
    return '[]'::jsonb;
  end if;
  if coalesce(pg_catalog.btrim(p_search), '') <> '' then
    q := pg_catalog.websearch_to_tsquery('simple'::regconfig, p_search);
  end if;
  return (select coalesce(jsonb_agg(public.library_card(x) order by x.published_at desc, x.id desc), '[]'::jsonb)
          from (select e.* from public.library_entries e
                where e.state = 'live' and e.removed_at is null and not public.account_held(e.user_id)
                  and (q is null or e.search @@ q)
                  and (p_tag is null or e.tags @> array[p_tag])
                  and (p_before is null or (e.published_at, e.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
                order by e.published_at desc, e.id desc
                limit greatest(1, least(coalesce(p_limit, 48), (lim->>'page')::integer))) x);
end $$;

revoke all on function public.library_bytes_of(uuid) from public, anon, authenticated;
