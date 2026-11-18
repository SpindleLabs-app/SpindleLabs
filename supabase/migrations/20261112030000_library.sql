-- The public library, first piece (community C3a1): publish a design with a licence and tags, browse and search
-- without an account, download it (signed in) into a new project. Behind the same off switch as sharing links
-- (share_switch): while it is off nothing is published, listed or downloaded, and people can still take their own
-- designs down and delete their files.
--
-- A design's file lives in Supabase Storage, in the PRIVATE bucket `library`, as `<entry id>.spindle` (never the
-- account's id in the name, so a download never says who published it). The database's free space is too small for a
-- library, which is why the files are not kept here as sharing links' copies are. Storage checks every upload, download
-- link and delete against the policies below, run as the person, so the rules live in one place:
--   - a person uploads one file, once, to an entry of theirs that begin_publish made in the last hour, while sharing is
--     on and their account isn't held; nobody can overwrite a file (no update policy);
--   - a signed-in person may get a download link for a live entry (not taken down, its author not held, sharing on), and
--     the author for their own entry's file whatever its state; nobody signed out gets one (browsing needs no account,
--     downloading does: AC2);
--   - only the author deletes their own entry's file.
-- A takedown, a hold or the off switch stops new download links at once; a link already made lasts its few minutes.
-- The browser never touches the table: only the functions below. supabase/test/test_library.py checks every rule here.

create table public.library_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  licence text not null,
  tags text[] not null default '{}',
  picture text,
  -- uploading: made by begin_publish, waiting for its file (an hour at most); live: published; off: taken down by its
  -- author, or an upload never finished.
  state text not null default 'uploading' check (state in ('uploading', 'live', 'off')),
  file_bytes bigint,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  off_at timestamptz,
  -- Set when the people who run SpindleLabs take it down after a report (C3a2's review list).
  removed_at timestamptz,
  search tsvector not null default ''::tsvector
);
revoke all on public.library_entries from anon, authenticated;
alter table public.library_entries enable row level security;
-- No policy: the browser reads and writes only through the functions below.
create index library_entries_live on public.library_entries (published_at desc, id desc) where state = 'live' and removed_at is null;
create index library_entries_user on public.library_entries (user_id, created_at);
create index library_entries_search on public.library_entries using gin (search);
create index library_entries_tags on public.library_entries using gin (tags);

-- A held account can't publish (moderation's trigger, which reads new.user_id).
create trigger library_entries_refuse_held before insert on public.library_entries for each row execute function public.refuse_held_account();

-- The limits, in one place so the app and the tests read the same numbers.
create function public.library_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('max_entries', 50, 'max_bytes', 52428800, 'max_file_bytes', 5242880, 'max_picture_bytes', 32768,
                            'entries_per_day', 10, 'max_title', 100, 'max_description', 2000, 'max_tags', 8, 'max_tag', 24,
                            'upload_minutes', 60, 'page', 48,
                            'licences', jsonb_build_array('CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC0-1.0'))
$$;

-- Words for full-text search: the title, the description and the tags, with no language's stemming (names of parts
-- aren't English sentences).
create function public.library_search_text(p_title text, p_description text, p_tags text[]) returns tsvector
language sql immutable set search_path = '' as $$
  select pg_catalog.setweight(pg_catalog.to_tsvector('simple'::regconfig, coalesce(p_title, '')), 'A')
      || pg_catalog.setweight(pg_catalog.to_tsvector('simple'::regconfig, pg_catalog.array_to_string(coalesce(p_tags, '{}'), ' ')), 'B')
      || pg_catalog.setweight(pg_catalog.to_tsvector('simple'::regconfig, coalesce(p_description, '')), 'C')
$$;

-- The file's name in the bucket.
create function public.library_file_name(p_id uuid) returns text
language sql immutable set search_path = '' as $$
  select p_id::text || '.spindle'
$$;

-- The entry a file name belongs to, or null for a name that isn't one of ours.
create function public.library_entry_of(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.spindle$'
              then pg_catalog.left(p_name, 36)::uuid end
$$;

-- Whether entry `e` is for everyone to see: live, not taken down, its author not held, sharing on.
create function public.library_entry_public(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select from public.library_entries e
                 where e.id = p_id and e.state = 'live' and e.removed_at is null and not public.account_held(e.user_id))
         and public.sharing_on()
$$;

-- The bytes of a file in the bucket (Storage writes its size into the object's metadata), or null when there is none.
create function public.library_file_bytes(p_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select (o.metadata->>'size')::bigint from storage.objects o
  where o.bucket_id = 'library' and o.name = public.library_file_name(p_id)
$$;

-- The policies' three questions, as the signed-in person (security definer, since the person can't read the table).
create function public.library_may_upload(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select from public.library_entries e
                 where e.id = public.library_entry_of(p_name) and e.user_id = auth.uid() and e.state = 'uploading'
                   and e.created_at > now() - make_interval(mins => (public.library_limits()->>'upload_minutes')::integer))
         and public.sharing_on() and not public.account_held(auth.uid())
$$;
create function public.library_may_read(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
         and (exists (select from public.library_entries e where e.id = public.library_entry_of(p_name) and e.user_id = auth.uid())
              or public.library_entry_public(public.library_entry_of(p_name)))
$$;
create function public.library_may_delete(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select from public.library_entries e where e.id = public.library_entry_of(p_name) and e.user_id = auth.uid())
$$;

-- The bucket: private (every read through a policy), 5 MiB a file, project files only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library', 'library', false, 5242880, array['application/json'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/json'];

create policy library_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'library' and public.library_may_upload(name));
create policy library_read on storage.objects for select to authenticated
  using (bucket_id = 'library' and public.library_may_read(name));
create policy library_delete on storage.objects for delete to authenticated
  using (bucket_id = 'library' and public.library_may_delete(name));

-- The person's uploads that never finished within the hour are turned off (their file, if any, stays theirs to delete).
create function public.library_close_stale(me uuid) returns void
language sql security definer set search_path = '' as $$
  update public.library_entries set state = 'off', off_at = now()
  where user_id = me and state = 'uploading'
    and created_at <= now() - make_interval(mins => (public.library_limits()->>'upload_minutes')::integer)
$$;

-- Whether a tag list is allowed: at most max_tags, each 2 to max_tag of a-z, 0-9 and '-', starting with a letter or
-- digit, no repeats.
create function public.library_tags_ok(p_tags text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p_tags is not null
         and coalesce(pg_catalog.array_length(p_tags, 1), 0) <= (public.library_limits()->>'max_tags')::integer
         and not exists (select from pg_catalog.unnest(p_tags) t
                         where t is null or t !~ '^[a-z0-9][a-z0-9-]*$' or pg_catalog.char_length(t) < 2
                            or pg_catalog.char_length(t) > (public.library_limits()->>'max_tag')::integer)
         and (select count(distinct t) from pg_catalog.unnest(p_tags) t) = coalesce(pg_catalog.array_length(p_tags, 1), 0)
$$;

-- Starts publishing: makes the entry and gives the file's name to upload to. Answers, never raising for these:
--   {"status":"ready","id":…,"file":"<id>.spindle"}
--   {"status":"bad"}    a title, description, licence, tag or picture that isn't allowed
--   {"status":"full"}   max_entries live or uploading already
--   {"status":"daily"}  entries_per_day started in the last day (taken down or not)
--   {"status":"held"}   the account is held by moderation
--   {"status":"off"}    sharing is switched off for everyone
create function public.begin_publish(p_title text, p_description text, p_licence text, p_tags text[], p_picture text) returns jsonb
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

-- Finishes publishing once the file is uploaded. Answers, never raising for these:
--   "live"     published: in the library for everyone
--   "missing"  no file has been uploaded for it yet
--   "too-big"  the file is over max_file_bytes (the bucket refuses those too)
--   "full"     the person's files would be over max_bytes in all
--   "gone"     no entry of the person's waiting for its file (never made, already live, taken down, or over an hour old)
--   "held"     the account is held by moderation
--   "off"      sharing is switched off for everyone
create function public.finish_publish(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.library_limits();
  bytes bigint;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if not public.sharing_on() then
    return 'off';
  end if;
  if public.account_held(me) then
    return 'held';
  end if;
  perform 1 from public.profiles where id = me for update;
  perform public.library_close_stale(me);
  if not exists (select from public.library_entries where id = p_id and user_id = me and state = 'uploading') then
    return 'gone';
  end if;
  bytes := public.library_file_bytes(p_id);
  if bytes is null then
    return 'missing';
  end if;
  if bytes > (lim->>'max_file_bytes')::integer then
    return 'too-big';
  end if;
  -- Every file of the person's in the bucket counts, live or not, until they delete it.
  if (select coalesce(sum(public.library_file_bytes(e.id)), 0) from public.library_entries e where e.user_id = me) > (lim->>'max_bytes')::bigint then
    return 'full';
  end if;
  update public.library_entries set state = 'live', file_bytes = bytes, published_at = now() where id = p_id;
  return 'live';
end $$;

-- Takes the person's own entry out of the library for good (the app then deletes its file). False when it isn't
-- theirs or is already off. Works while sharing is off or the person is held.
create function public.unpublish(p_id uuid) returns boolean
language sql security definer set search_path = '' as $$
  update public.library_entries set state = 'off', off_at = now()
  where id = p_id and user_id = auth.uid() and state <> 'off'
  returning true
$$;

-- An entry as anyone sees it in a list: never the author's account id, only their display name (null without one).
create function public.library_card(e public.library_entries) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'title', e.title, 'picture', e.picture, 'licence', e.licence, 'tags', to_jsonb(e.tags),
                            'published_at', e.published_at,
                            'author', (select d.name from public.display_names d where d.user_id = e.user_id))
$$;

-- The library for anyone, signed in or not, newest first, a page at a time: `p_search` (words; empty for all) and
-- `p_tag` (one tag; null for all), then the page after the card (`p_before`, `p_before_id`) last shown. Null while
-- sharing is off.
create function public.browse_library(p_search text, p_tag text, p_before timestamptz, p_before_id uuid, p_limit integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.sharing_on() then
    (select coalesce(jsonb_agg(public.library_card(x) order by x.published_at desc, x.id desc), '[]'::jsonb)
     from (select e.* from public.library_entries e
           where e.state = 'live' and e.removed_at is null and not public.account_held(e.user_id)
             and (coalesce(pg_catalog.btrim(p_search), '') = '' or e.search @@ pg_catalog.websearch_to_tsquery('simple'::regconfig, p_search))
             and (p_tag is null or e.tags @> array[p_tag])
             and (p_before is null or (e.published_at, e.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
           order by e.published_at desc, e.id desc
           limit greatest(1, least(coalesce(p_limit, 48), (public.library_limits()->>'page')::integer))) x)
  end
$$;

-- One entry for anyone, with its description and size; null when it isn't public (or sharing is off). `mine` says
-- whether the signed-in person published it.
create function public.library_entry(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.library_card(e) || jsonb_build_object('description', e.description, 'bytes', e.file_bytes, 'file', public.library_file_name(e.id),
                                                      'mine', e.user_id is not distinct from auth.uid())
  from public.library_entries e where e.id = p_id and public.library_entry_public(e.id)
$$;

-- The person's own entries (not the off ones whose file is gone), newest first, with their state and whether the
-- bucket still has a file for them (an off entry with a file is one to delete; the app does it).
create function public.my_library() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.library_card(e) || jsonb_build_object('state', e.state, 'removed_at', e.removed_at, 'created_at', e.created_at,
                                                                          'file', public.library_file_name(e.id), 'bytes', public.library_file_bytes(e.id))
                            order by e.created_at desc, e.id desc), '[]'::jsonb)
  from public.library_entries e
  where e.user_id = auth.uid() and (e.state <> 'off' or public.library_file_bytes(e.id) is not null)
$$;

-- The library's part of Download my data: every entry the person made, whatever its state, without the pictures.
create function public.my_data_part_library() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('library', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description,
                                                                                    'licence', e.licence, 'tags', to_jsonb(e.tags), 'state', e.state,
                                                                                    'created_at', e.created_at, 'published_at', e.published_at,
                                                                                    'off_at', e.off_at, 'removed_at', e.removed_at)
                                                                 order by e.created_at, e.id), '[]'::jsonb)
                                        from public.library_entries e where e.user_id = auth.uid()))
$$;

revoke all on function public.library_limits(), public.library_search_text(text, text, text[]), public.library_file_name(uuid), public.library_entry_of(text),
  public.library_entry_public(uuid), public.library_file_bytes(uuid), public.library_may_upload(text), public.library_may_read(text), public.library_may_delete(text),
  public.library_close_stale(uuid), public.library_tags_ok(text[]), public.begin_publish(text, text, text, text[], text), public.finish_publish(uuid),
  public.unpublish(uuid), public.library_card(public.library_entries), public.browse_library(text, text, timestamptz, uuid, integer), public.library_entry(uuid),
  public.my_library(), public.my_data_part_library() from public, anon, authenticated;
grant execute on function public.library_limits(), public.browse_library(text, text, timestamptz, uuid, integer), public.library_entry(uuid) to anon, authenticated;
grant execute on function public.begin_publish(text, text, text, text[], text), public.finish_publish(uuid), public.unpublish(uuid), public.my_library() to authenticated;
-- The storage policies run as the person and ask these.
grant execute on function public.library_may_upload(text), public.library_may_read(text), public.library_may_delete(text) to authenticated;
