-- Settings that follow you (account features 3): a signed-in person's settings (the theme, units, slicer presets and
-- choices, the print check, the build area) kept in their account, so every device they sign in on uses the same ones.
-- Only for people who leave "Keep my settings in my account" on (profiles.keep_settings); the app never sends
-- settings otherwise. Never an AI key, a sign-in or a design: the app sends only the settings it lists
-- (apps/fission/src/settings-sync.ts), and this checks every name looks like one of SpindleLabs' own.
--
-- One row per person: the settings as a JSON object of names to text (each exactly as the browser keeps it), and a
-- revision. The browser never writes the table directly: save_settings() checks the sizes and that the copy being
-- replaced is the one the device last saw, so two devices never silently overwrite each other's changes (the app
-- merges them first, setting by setting). supabase/test/test_settings.py checks every rule here on a real PostgreSQL.

-- Off switch, per person, followed on every device. On by default, like keeping designs: the sign-in dialog says so.
alter table public.profiles add column keep_settings boolean not null default true;

create table public.account_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- {"<name>": "<text>", ...}: checked again by save_settings, which is the only way in.
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  -- Goes up by one on every save: a device saves only when it names the revision it last saw (0 before the first).
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now()
);

revoke all on public.account_settings from anon, authenticated;
alter table public.account_settings enable row level security;
-- Reading is through the functions below; this policy is the second lock behind them, should a grant ever be added.
create policy "own settings only" on public.account_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The limits, in one place so the app and the tests read the same numbers: at most 64 settings, 256 KiB in all
-- (the settings' names and text, as UTF-8), each name at most 100 characters.
create function public.settings_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('max_settings', 64, 'max_bytes', 262144, 'max_name', 100)
$$;

-- The person's settings: {"keep": bool, "revision": n, "settings": {...}}; revision 0 and no settings before the first save.
create function public.my_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  keep boolean;
  row_ public.account_settings;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  select keep_settings into keep from public.profiles where id = me;
  select * into row_ from public.account_settings where user_id = me;
  return jsonb_build_object('keep', coalesce(keep, false), 'revision', coalesce(row_.revision, 0), 'settings', coalesce(row_.settings, '{}'::jsonb));
end $$;

-- Replaces the person's settings with p_settings, but only when their revision is still p_expected (0: none kept yet).
-- Answers, never raising for these:
--   {"status": "saved", "revision": n}
--   {"status": "changed", "revision": n}  another device saved since p_expected: nothing written
--   {"status": "too-big"}                 over the number of settings or the size
--   {"status": "invalid"}                 not an object of SpindleLabs setting names to text
--   {"status": "off"}                     the person turned off keeping settings
create function public.save_settings(p_settings jsonb, p_expected integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.settings_limits();
  keep boolean;
  current_rev integer;
  n integer;
  bytes bigint;
  bad integer;
  saved integer;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  -- One save at a time per person.
  select keep_settings into keep from public.profiles where id = me for update;
  if keep is distinct from true then
    return jsonb_build_object('status', 'off');
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or p_expected is null or p_expected < 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- Every name is one of SpindleLabs' own ("spindlelabs" then letters, digits and . - / _), every value text.
  select count(*) filter (where jsonb_typeof(e.value) <> 'string' or e.key !~ '^spindlelabs[A-Za-z0-9./_-]*$' or char_length(e.key) > (lim->>'max_name')::integer)
    into bad from jsonb_each(p_settings) e;
  if bad > 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select count(*), coalesce(sum(octet_length(e.key) + octet_length(e.value #>> '{}')), 0) into n, bytes from jsonb_each(p_settings) e;
  if n > (lim->>'max_settings')::integer or bytes > (lim->>'max_bytes')::bigint then
    return jsonb_build_object('status', 'too-big');
  end if;
  select revision into current_rev from public.account_settings where user_id = me;
  if coalesce(current_rev, 0) <> p_expected then
    return jsonb_build_object('status', 'changed', 'revision', coalesce(current_rev, 0));
  end if;
  if current_rev is null then
    insert into public.account_settings (user_id, settings) values (me, p_settings) returning revision into saved;
  else
    update public.account_settings set settings = p_settings, revision = revision + 1, updated_at = now()
      where user_id = me returning revision into saved;
  end if;
  return jsonb_build_object('status', 'saved', 'revision', saved);
end $$;

-- Turns keeping settings on or off on every device. Off deletes the settings kept in the account straight away
-- (each browser keeps its own). Gives the choice now.
create function public.set_keep_settings(p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  update public.profiles set keep_settings = (p_on is true) where id = me;
  if p_on is not true then
    delete from public.account_settings where user_id = me;
  end if;
  return p_on is true;
end $$;

-- Deletes the settings kept in the person's account (the browsers' own stay); true when there were some.
create function public.delete_my_settings() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.account_settings where user_id = auth.uid();
  return found;
end $$;

-- Download my data's part (see my_data in 20261105120000_my_designs.sql): the settings kept, null when none.
create function public.my_data_part_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('settings', (select jsonb_build_object('settings', s.settings, 'revision', s.revision, 'updated_at', s.updated_at) from public.account_settings s where s.user_id = auth.uid()))
$$;

revoke all on function public.settings_limits(), public.my_settings(), public.save_settings(jsonb, integer), public.set_keep_settings(boolean), public.delete_my_settings(), public.my_data_part_settings() from public, anon, authenticated;
grant execute on function public.settings_limits(), public.my_settings(), public.save_settings(jsonb, integer), public.set_keep_settings(boolean), public.delete_my_settings() to authenticated;
