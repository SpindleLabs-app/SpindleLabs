-- My designs: copies of a signed-in person's designs kept in their account, so they can open them on any device.
-- Only for people who sign in and leave "Keep my designs in my account" on (profiles.keep_designs); the app never
-- sends a design otherwise. Each design is the project's own file text, as Save would write it, plus a small
-- picture of it, its name, the workspace it was saved from and when.
--
-- The browser never writes the table directly: save_design() checks the sizes, the person's space, and that the
-- copy being replaced is the one the device last saw (so two devices never silently overwrite each other).
-- supabase/test/test_database.py checks every rule here against a real PostgreSQL.

-- Off switch, per person, followed on every device. On by default: keeping designs is what an account is for, and
-- the sign-in dialog says so before anyone signs in.
alter table public.profiles add column keep_designs boolean not null default true;
grant update (keep_designs) on public.profiles to authenticated;

create table public.designs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) <= 200),
  -- The workspace it was last saved from: the tag shown on My designs.
  source text not null check (source in ('design', 'render', 'simulate', 'manufacture', 'laser', 'slice', 'circuit', 'vector', 'image', 'layout')),
  -- The project file's text (.spindlelabs.json), at most 5 MiB.
  body text not null check (octet_length(body) <= 5242880),
  -- A small picture of it (a data: address, at most 32 KiB), or none.
  picture text check (picture is null or (octet_length(picture) <= 32768 and picture ~ '^data:image/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$')),
  bytes integer generated always as (octet_length(body) + coalesce(octet_length(picture), 0)) stored,
  -- When it was saved on the device, and when it reached the account.
  saved_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Goes up by one on every save: a device saves over a copy only when it names the revision it last saw.
  revision integer not null default 1 check (revision >= 1)
);
create index designs_by_person on public.designs (user_id, updated_at desc);

revoke all on public.designs from anon, authenticated;
alter table public.designs enable row level security;
-- Reading is through the functions below; this policy is the second lock behind them, should a grant ever be added.
create policy "own designs only" on public.designs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The limits, in one place so the app and the tests read the same numbers.
create function public.design_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('max_designs', 200, 'max_bytes', 20971520, 'max_design_bytes', 5242880, 'max_picture_bytes', 32768)
$$;

-- Saves a design to the person's account. p_id null adds a new one; otherwise it replaces design p_id, but only when
-- its revision is still p_expected. p_picture null keeps the picture it has. Answers, never raising for these:
--   {"status": "saved", "id": ..., "revision": n, "updated_at": ...}
--   {"status": "changed", "revision": n}  another device saved it since p_expected: nothing written
--   {"status": "gone"}                    no such design of this person's (deleted, maybe on another device)
--   {"status": "too-big"}                 the design or its picture is over the limit
--   {"status": "full"}                    the person's space or number of designs would go over the limit
--   {"status": "off"}                     the person turned off keeping designs
create function public.save_design(p_id uuid, p_expected integer, p_name text, p_source text, p_body text, p_picture text, p_saved_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.design_limits();
  keep boolean;
  current_rev integer;
  old_bytes integer := 0;
  new_bytes integer;
  used bigint;
  n integer;
  out_row public.designs;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  -- One save at a time per person, so two saves can't both fit in space only one has.
  select keep_designs into keep from public.profiles where id = me for update;
  if keep is distinct from true then
    return jsonb_build_object('status', 'off');
  end if;
  if p_body is null or octet_length(p_body) > (lim->>'max_design_bytes')::integer
     or (p_picture is not null and octet_length(p_picture) > (lim->>'max_picture_bytes')::integer) then
    return jsonb_build_object('status', 'too-big');
  end if;
  if p_id is not null then
    select revision, bytes into current_rev, old_bytes from public.designs where id = p_id and user_id = me;
    if not found then
      return jsonb_build_object('status', 'gone');
    end if;
    if current_rev <> p_expected then
      return jsonb_build_object('status', 'changed', 'revision', current_rev);
    end if;
    -- The new size: the kept picture counts when none is sent.
    select octet_length(p_body) + coalesce(octet_length(coalesce(p_picture, picture)), 0) into new_bytes from public.designs where id = p_id;
  else
    new_bytes := octet_length(p_body) + coalesce(octet_length(p_picture), 0);
    select count(*) into n from public.designs where user_id = me;
    if n >= (lim->>'max_designs')::integer then
      return jsonb_build_object('status', 'full');
    end if;
  end if;
  select coalesce(sum(bytes), 0) into used from public.designs where user_id = me;
  if used - old_bytes + new_bytes > (lim->>'max_bytes')::bigint then
    return jsonb_build_object('status', 'full');
  end if;
  if p_id is null then
    insert into public.designs (user_id, name, source, body, picture, saved_at)
      values (me, p_name, p_source, p_body, p_picture, p_saved_at)
      returning * into out_row;
  else
    update public.designs set name = p_name, source = p_source, body = p_body, picture = coalesce(p_picture, picture),
        saved_at = p_saved_at, updated_at = now(), revision = revision + 1
      where id = p_id and user_id = me and revision = p_expected
      returning * into out_row;
    if not found then
      return jsonb_build_object('status', 'gone'); -- deleted by another request since it was read above
    end if;
  end if;
  return jsonb_build_object('status', 'saved', 'id', out_row.id, 'revision', out_row.revision, 'updated_at', out_row.updated_at);
end $$;

-- The person's designs, newest first, without their file text (for the My designs list).
create function public.my_designs() returns table (id uuid, name text, source text, picture text, bytes integer, saved_at timestamptz, updated_at timestamptz, revision integer)
language sql stable security definer set search_path = '' as $$
  select d.id, d.name, d.source, d.picture, d.bytes, d.saved_at, d.updated_at, d.revision
  from public.designs d where d.user_id = auth.uid() order by d.updated_at desc, d.id
$$;

-- One of the person's designs with its file text, or null.
create function public.get_design(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'name', d.name, 'source', d.source, 'body', d.body, 'saved_at', d.saved_at, 'updated_at', d.updated_at, 'revision', d.revision)
  from public.designs d where d.id = p_id and d.user_id = auth.uid()
$$;

-- Deletes one of the person's designs from their account; true when there was one.
create function public.delete_design(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.designs where id = p_id and user_id = auth.uid();
  return found;
end $$;

-- Deletes every design in the person's account (turning off keeping designs offers it); how many went.
create function public.delete_my_designs() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.designs where user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

-- How much of the person's space is used.
create function public.my_design_space() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.design_limits() || jsonb_build_object('designs', count(*), 'bytes', coalesce(sum(bytes), 0))
  from public.designs where user_id = auth.uid()
$$;

-- Everything kept about the person (Privacy Act, APP 12), built from parts: the account's own, then every function
-- named my_data_part_<name>() in public, each giving a JSON object of its own keys. A new feature adds its part and
-- never replaces this function again, so no feature's data can drop out of Download my data.
create or replace function public.my_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
  part record;
  piece jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  select jsonb_build_object(
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'from_google', u.raw_user_meta_data) from auth.users u where u.id = auth.uid()),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'plan', (select to_jsonb(l) from public.plans l where l.user_id = auth.uid()),
    'ai_allowance_used_percent', public.my_allowance())
  into result;
  for part in
    select p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'my\_data\_part\_%' and p.pronargs = 0
      -- only parts made by whoever made this function (the migrations), never one anyone else could add
      and p.proowner = (select f.proowner from pg_catalog.pg_proc f where f.oid = 'public.my_data()'::pg_catalog.regprocedure)
    order by p.proname
  loop
    execute format('select public.%I()', part.proname) into piece;
    result := result || coalesce(piece, '{}'::jsonb);
  end loop;
  return result;
end $$;

-- My designs' part: every design, whole.
create function public.my_data_part_designs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('designs', coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'source', d.source, 'saved_at', d.saved_at, 'created_at', d.created_at, 'updated_at', d.updated_at, 'revision', d.revision, 'picture', d.picture, 'file', d.body) order by d.created_at), '[]'::jsonb))
  from public.designs d where d.user_id = auth.uid()
$$;

revoke all on function public.design_limits(), public.save_design(uuid, integer, text, text, text, text, timestamptz), public.my_designs(), public.get_design(uuid), public.delete_design(uuid), public.delete_my_designs(), public.my_design_space(), public.my_data(), public.my_data_part_designs() from public, anon, authenticated;
grant execute on function public.design_limits(), public.save_design(uuid, integer, text, text, text, text, timestamptz), public.my_designs(), public.get_design(uuid), public.delete_design(uuid), public.delete_my_designs(), public.my_design_space(), public.my_data() to authenticated;
