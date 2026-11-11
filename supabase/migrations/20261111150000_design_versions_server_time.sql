-- Earlier versions decided by the server's own clock, and save_design's last two unchecked inputs (issue #546, items
-- 10-12). Replaces save_design from 20261105180000_design_versions.sql with the same signature, grants, security
-- definer and search_path; changes:
--  * A version's kept_at is now the server's time when that state reached the account (the replaced design's
--    updated_at), and the 10-minute gap is measured by it: the copy a save replaces is kept when the design has no
--    version yet or the copy reached the account at least version_gap_seconds after the newest version did. The
--    newest versions_kept, and the versions given up first when the space is over, are by kept_at too. saved_at,
--    the device's own clock, is only the version's label: a device with its clock ahead (or behind) no longer stops
--    versions being kept, nor makes its version the last ever given up.
--  * A saved_at that is null or not a finite time (only a hand-made request can send one) is refused as "too-big"
--    instead of being kept; a design that already holds one can be saved over (its copy is not kept as a version).
--    A time far ahead is kept as the device's label, as before: it no longer harms anything.
--  * An existing design saved with p_expected null answers "changed" (is distinct from), not "gone".
-- Safe to run more than once (create or replace; the grants are the same as before).
-- supabase/test/test_design_versions_time.py and test_design_versions.py check these on a real PostgreSQL.

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
  old_written timestamptz;
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
  -- A save time no clock gives: refused like a file the account can't keep, so it never reaches a design.
  if p_saved_at is null or not isfinite(p_saved_at) then
    return jsonb_build_object('status', 'too-big');
  end if;
  if p_id is not null then
    select revision, bytes, body, saved_at, updated_at into current_rev, old_bytes, old_body, old_saved, old_written from public.designs where id = p_id and user_id = me;
    if not found then
      return jsonb_build_object('status', 'gone');
    end if;
    if current_rev is distinct from p_expected then
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
    -- The copy just replaced, kept as a version when it is a different state and it reached the account (server
    -- time) long enough after the newest version did. A copy labelled with no real time is not kept.
    if old_body is distinct from p_body and isfinite(old_saved) then
      select max(kept_at) into newest from public.design_versions where design_id = p_id;
      if newest is null or old_written - newest >= make_interval(secs => (lim->>'version_gap_seconds')::integer) then
        insert into public.design_versions (design_id, user_id, saved_at, body, kept_at) values (p_id, me, old_saved, old_body, old_written)
          on conflict (design_id, saved_at) do nothing;
      end if;
      delete from public.design_versions where design_id = p_id and saved_at not in
        (select v.saved_at from public.design_versions v where v.design_id = p_id order by v.kept_at desc, v.saved_at desc limit (lim->>'versions_kept')::integer);
    end if;
  end if;
  -- Over the space with the versions: the person's versions that reached the account first go first.
  loop
    select (select coalesce(sum(bytes), 0) from public.designs where user_id = me)
         + (select coalesce(sum(bytes), 0) from public.design_versions where user_id = me) into used;
    exit when used <= (lim->>'max_bytes')::bigint;
    select design_id, saved_at into oldest from public.design_versions where user_id = me order by kept_at, saved_at, design_id limit 1;
    exit when not found;
    delete from public.design_versions where design_id = oldest.design_id and saved_at = oldest.saved_at;
  end loop;
  return jsonb_build_object('status', 'saved', 'id', out_row.id, 'revision', out_row.revision, 'updated_at', out_row.updated_at);
end $$;

revoke all on function public.save_design(uuid, integer, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_design(uuid, integer, text, text, text, text, timestamptz) to authenticated;
