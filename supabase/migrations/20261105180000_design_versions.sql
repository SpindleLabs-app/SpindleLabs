-- Earlier versions of the designs in a person's account (account features 2), so a design can go back to how it was
-- from any device. Nothing more is sent for them: when save_design replaces a design, the account keeps the copy it
-- replaces as a version, at most one every 10 minutes and the newest 20 of each design, as the browser keeps its own
-- (@fission/storage versions.ts). Versions count in the person's 20 MiB; a save that would go over deletes the
-- oldest versions first, so they never cost a save. Deleting a design deletes its versions.
-- supabase/test/test_design_versions.py checks every rule here against a real PostgreSQL.

create table public.design_versions (
  design_id uuid not null references public.designs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- When the version was saved on its device (the design's saved_at before the save that replaced it).
  saved_at timestamptz not null,
  body text not null check (octet_length(body) <= 5242880),
  bytes integer generated always as (octet_length(body)) stored,
  kept_at timestamptz not null default now(),
  primary key (design_id, saved_at)
);
create index design_versions_by_person on public.design_versions (user_id, saved_at);

revoke all on public.design_versions from anon, authenticated;
alter table public.design_versions enable row level security;
-- Reading is through the functions below; this policy is the second lock behind them, should a grant ever be added.
create policy "own versions only" on public.design_versions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The limits, with the versions' own two.
create or replace function public.design_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('max_designs', 200, 'max_bytes', 20971520, 'max_design_bytes', 5242880, 'max_picture_bytes', 32768, 'versions_kept', 20, 'version_gap_seconds', 600)
$$;

-- As before (20261105120000_my_designs.sql), and: the copy a save replaces is kept as a version when it differs and
-- the newest version is at least version_gap_seconds older; then the design's newest versions_kept only; then, while
-- the person is over max_bytes, their oldest versions go. A save that can't fit without any versions is still "full".
create or replace function public.save_design(p_id uuid, p_expected integer, p_name text, p_source text, p_body text, p_picture text, p_saved_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.design_limits();
  keep boolean;
  current_rev integer;
  old_bytes integer := 0;
  old_body text;
  old_saved timestamptz;
  newest timestamptz;
  new_bytes integer;
  used bigint;
  n integer;
  out_row public.designs;
  oldest record;
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
    select revision, bytes, body, saved_at into current_rev, old_bytes, old_body, old_saved from public.designs where id = p_id and user_id = me;
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
  -- Versions never cost a save: whether it fits is decided by the designs alone.
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
    -- The copy just replaced, kept as a version when it is a different state and the newest is old enough.
    if old_body is distinct from p_body then
      select max(saved_at) into newest from public.design_versions where design_id = p_id;
      if newest is null or old_saved - newest >= make_interval(secs => (lim->>'version_gap_seconds')::integer) then
        insert into public.design_versions (design_id, user_id, saved_at, body) values (p_id, me, old_saved, old_body)
          on conflict (design_id, saved_at) do nothing;
      end if;
      delete from public.design_versions where design_id = p_id and saved_at not in
        (select v.saved_at from public.design_versions v where v.design_id = p_id order by v.saved_at desc limit (lim->>'versions_kept')::integer);
    end if;
  end if;
  -- Over the space with the versions: the person's oldest versions go first.
  loop
    select (select coalesce(sum(bytes), 0) from public.designs where user_id = me)
         + (select coalesce(sum(bytes), 0) from public.design_versions where user_id = me) into used;
    exit when used <= (lim->>'max_bytes')::bigint;
    select design_id, saved_at into oldest from public.design_versions where user_id = me order by saved_at, design_id limit 1;
    exit when not found;
    delete from public.design_versions where design_id = oldest.design_id and saved_at = oldest.saved_at;
  end loop;
  return jsonb_build_object('status', 'saved', 'id', out_row.id, 'revision', out_row.revision, 'updated_at', out_row.updated_at);
end $$;

-- When each kept version of one of the person's designs was saved, newest first (none for someone else's design).
create function public.design_versions(p_id uuid) returns table (saved_at timestamptz, bytes integer)
language sql stable security definer set search_path = '' as $$
  select v.saved_at, v.bytes from public.design_versions v where v.design_id = p_id and v.user_id = auth.uid() order by v.saved_at desc
$$;

-- One version's file text, or null when there is none of the person's at that time.
create function public.get_design_version(p_id uuid, p_saved_at timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('saved_at', v.saved_at, 'body', v.body)
  from public.design_versions v where v.design_id = p_id and v.saved_at = p_saved_at and v.user_id = auth.uid()
$$;

-- How much of the person's space is used: the designs and their versions.
create or replace function public.my_design_space() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.design_limits() || jsonb_build_object(
    'designs', (select count(*) from public.designs where user_id = auth.uid()),
    'bytes', (select coalesce(sum(bytes), 0) from public.designs where user_id = auth.uid())
           + (select coalesce(sum(bytes), 0) from public.design_versions where user_id = auth.uid()),
    'version_bytes', (select coalesce(sum(bytes), 0) from public.design_versions where user_id = auth.uid()))
$$;

-- Download my data's part: every version, whole.
create function public.my_data_part_design_versions() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('design_versions', coalesce(jsonb_agg(jsonb_build_object('design_id', v.design_id, 'saved_at', v.saved_at, 'kept_at', v.kept_at, 'file', v.body) order by v.design_id, v.saved_at), '[]'::jsonb))
  from public.design_versions v where v.user_id = auth.uid()
$$;

revoke all on function public.design_limits(), public.save_design(uuid, integer, text, text, text, text, timestamptz), public.design_versions(uuid), public.get_design_version(uuid, timestamptz), public.my_design_space(), public.my_data_part_design_versions() from public, anon, authenticated;
grant execute on function public.design_limits(), public.save_design(uuid, integer, text, text, text, text, timestamptz), public.design_versions(uuid), public.get_design_version(uuid, timestamptz), public.my_design_space() to authenticated;
