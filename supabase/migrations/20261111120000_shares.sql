-- Sharing links (community step C2a): a signed-in person shares a frozen copy of a design, and anyone with the link
-- can open it as their own copy. The link is a random id (a version 4 UUID: 122 random bits), so links can't be
-- guessed or listed; nobody but the person who shared it can list their links, and opening one never says who
-- shared it. Turning a link off deletes the copy it held at once. Anyone may report a link; reports are kept for the
-- people who run SpindleLabs to review (C5), even after the link goes, as the record of what was reported.
--
-- The browser never touches the tables: only the functions below. The app keeps the feature behind a switch until
-- its legal check is done. supabase/test/test_shares.py checks every rule here against a real PostgreSQL.

create table public.shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) <= 200),
  -- The project file's text as shared (.spindlelabs.json), at most 5 MiB; emptied when the link is turned off.
  body text not null check (octet_length(body) <= 5242880),
  picture text check (picture is null or (octet_length(picture) <= 32768 and picture ~ '^data:image/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$')),
  bytes integer generated always as (octet_length(body) + coalesce(octet_length(picture), 0)) stored,
  created_at timestamptz not null default now(),
  -- Set when the person turns the link off (the copy is emptied then) ...
  off_at timestamptz,
  -- ... or when the people who run SpindleLabs take it down after a report.
  removed_at timestamptz,
  check (off_at is null or (body = '' and picture is null))
);
create index shares_by_person on public.shares (user_id, created_at desc);

revoke all on public.shares from anon, authenticated;
alter table public.shares enable row level security;
-- Reading is through the functions below; this policy is the second lock behind them, should a grant ever be added.
create policy "own shares only" on public.shares for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.share_reports (
  id bigint generated always as identity primary key,
  -- No foreign key: a report outlives the link it is about.
  share_id uuid not null,
  -- Who reported it, when signed in; forgotten (null) when they delete their account, the report itself kept.
  reporter uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('copied', 'weapon', 'sexual', 'hateful', 'illegal', 'not-a-design', 'personal-info', 'other')),
  reason text not null check (char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);
create index share_reports_by_share on public.share_reports (share_id);

revoke all on public.share_reports from anon, authenticated;
-- Its id sequence too: Supabase's default grants would let the browser move it to its end and break every report.
revoke all on sequence public.share_reports_id_seq from anon, authenticated;
alter table public.share_reports enable row level security;
-- No policy: only the functions below and the server touch it.

-- The off switch for all of sharing: one row, off until the owner turns it on (from the dashboard or with
-- set_sharing as the server). While it is off nobody can make a link, open one or report one; people can still see
-- and turn off their own links. Closed to the browser, which learns it only from the answers below.
create table public.share_switch (
  id boolean primary key default true check (id),
  sharing_on boolean not null default false,
  changed_at timestamptz not null default now()
);
revoke all on public.share_switch from anon, authenticated;
alter table public.share_switch enable row level security;
insert into public.share_switch (id) values (true);

create function public.sharing_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select sharing_on from public.share_switch where id), false)
$$;

-- Server only: turns sharing on or off for everyone.
create function public.set_sharing(p_on boolean) returns boolean
language sql security definer set search_path = '' as $$
  update public.share_switch set sharing_on = coalesce(p_on, false), changed_at = now() where id returning sharing_on
$$;

-- The limits, in one place so the app and the tests read the same numbers.
create function public.share_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('max_links', 50, 'max_bytes', 20971520, 'max_share_bytes', 5242880, 'max_picture_bytes', 32768,
    'links_per_day', 20, 'reports_per_person', 5, 'reports_per_link', 200, 'signed_out_reports_per_link', 20, 'reports_per_person_per_day', 50, 'max_reason', 1000)
$$;

-- Shares a frozen copy of a design. Answers, never raising for these:
--   {"status": "shared", "id": ..., "created_at": ...}
--   {"status": "too-big"}  the file text or its picture is over the limit
--   {"status": "full"}     the person's links that are on, or their space, would go over the limit
--   {"status": "daily"}    the person made as many links as a day allows (the last 24 hours, turned off ones too)
--   {"status": "off"}      sharing is switched off for everyone
--   {"status": "held"}     the person's account is held by moderation
create function public.share_design(p_name text, p_body text, p_picture text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.share_limits();
  new_bytes integer;
  links integer;
  used bigint;
  today integer;
  out_row public.shares;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if not public.sharing_on() then
    return jsonb_build_object('status', 'off');
  end if;
  -- One share at a time per person, so two shares can't both fit in room only one has.
  perform 1 from public.profiles where id = me for update;
  if p_body is null or p_body = '' or octet_length(p_body) > (lim->>'max_share_bytes')::integer
     or (p_picture is not null and octet_length(p_picture) > (lim->>'max_picture_bytes')::integer) then
    return jsonb_build_object('status', 'too-big');
  end if;
  select count(*) into today from public.shares where user_id = me and created_at > now() - interval '24 hours';
  if today >= (lim->>'links_per_day')::integer then
    return jsonb_build_object('status', 'daily');
  end if;
  new_bytes := octet_length(p_body) + coalesce(octet_length(p_picture), 0);
  select count(*), coalesce(sum(bytes), 0) into links, used from public.shares where user_id = me and off_at is null and removed_at is null;
  if links >= (lim->>'max_links')::integer or used + new_bytes > (lim->>'max_bytes')::bigint then
    return jsonb_build_object('status', 'full');
  end if;
  begin
    insert into public.shares (user_id, name, body, picture) values (me, coalesce(p_name, ''), p_body, p_picture) returning * into out_row;
  exception when raise_exception then
    -- A hold on the account (moderation, a later migration) refuses the row where it is written.
    if sqlerrm = 'account held' then
      return jsonb_build_object('status', 'held');
    end if;
    raise;
  end;
  return jsonb_build_object('status', 'shared', 'id', out_row.id, 'created_at', out_row.created_at);
end $$;

-- A link's copy, for anyone with the link (signed in or not), or null when the link is off, taken down or never was,
-- or sharing is switched off.
-- Never says who shared it.
create function public.open_share(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'body', s.body, 'picture', s.picture, 'created_at', s.created_at)
  from public.shares s where s.id = p_id and s.off_at is null and s.removed_at is null and public.sharing_on()
$$;

-- The person's links that are on, newest first, without their file text. A link taken down after a report is listed
-- with its removed_at, so the person sees what happened to it.
create function public.my_shares() returns table (id uuid, name text, picture text, bytes integer, created_at timestamptz, removed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.picture, s.bytes, s.created_at, s.removed_at
  from public.shares s where s.user_id = auth.uid() and s.off_at is null order by s.created_at desc, s.id
$$;

-- Turns one of the person's links off: nobody can open it again and its copy is deleted. True when there was one on.
create function public.unshare(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  update public.shares set off_at = now(), body = '', picture = null
    where id = p_id and user_id = auth.uid() and off_at is null;
  return found;
end $$;

-- Reports a link, for anyone who can open it. Answers:
--   "kept"    the report is kept for review
--   "gone"    no link that is on has this id (nothing kept)
--   "own"     the person who shared the link reported it (nothing kept: they can turn it off)
--   "held"    the reporter's account is held by moderation
--   "enough"  this person already reported it as often as allowed (5 times, or 50 reports in the last 24 hours across
--             every link), or the link has as many reports of this kind
--             (signed in, or signed out) as are kept
--   "bad"     the kind is not one of the list, or the reason is too long (nothing kept)
--   "off"     sharing is switched off for everyone (nothing kept)
-- Signed-out reports have no person to count by, so they have their own small cap a link, and never count against
-- the signed-in ones: a flood of signed-out reports can't make a link unreportable (security review 2026-11-11).
create function public.report_share(p_id uuid, p_kind text, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  lim jsonb := public.share_limits();
  me uuid := auth.uid();
  sharer uuid;
  n integer;
begin
  if not public.sharing_on() then
    return 'off';
  end if;
  if p_kind is null or p_kind not in ('copied', 'weapon', 'sexual', 'hateful', 'illegal', 'not-a-design', 'personal-info', 'other')
     or char_length(coalesce(p_reason, '')) > (lim->>'max_reason')::integer then
    return 'bad';
  end if;
  -- One report at a time per link, so the caps below hold under racing reports.
  select user_id into sharer from public.shares where id = p_id and off_at is null and removed_at is null for update;
  if not found then
    return 'gone';
  end if;
  if me is null then
    select count(*) into n from public.share_reports where share_id = p_id and reporter is null;
    if n >= (lim->>'signed_out_reports_per_link')::integer then
      return 'enough';
    end if;
  else
    if me = sharer then
      return 'own';
    end if;
    select count(*) into n from public.share_reports where share_id = p_id and reporter is not null;
    if n >= (lim->>'reports_per_link')::integer then
      return 'enough';
    end if;
    select count(*) into n from public.share_reports where share_id = p_id and reporter = me;
    if n >= (lim->>'reports_per_person')::integer then
      return 'enough';
    end if;
    -- Across every link too, so one account can't flood the review list (security review 2026-11-11).
    select count(*) into n from public.share_reports where reporter = me and created_at > now() - interval '24 hours';
    if n >= (lim->>'reports_per_person_per_day')::integer then
      return 'enough';
    end if;
  end if;
  begin
    insert into public.share_reports (share_id, reporter, kind, reason) values (p_id, me, p_kind, coalesce(p_reason, ''));
  exception when raise_exception then
    if sqlerrm = 'account held' then
      return 'held';
    end if;
    raise;
  end;
  return 'kept';
end $$;

-- Takes a link down after a report (server only, until C5's review list): nobody can open it, the person who shared
-- it sees it listed as taken down, and its copy is kept for the record until they turn it off. True when it was up.
create function public.remove_share(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.shares set removed_at = now() where id = p_id and removed_at is null and off_at is null;
  return found;
end $$;

-- Sharing's part of Download my data: every link the person made (turned off ones with their copy already gone) and
-- every report they made.
create function public.my_data_part_shares() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'shares', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'created_at', s.created_at, 'off_at', s.off_at, 'removed_at', s.removed_at, 'picture', s.picture, 'file', s.body) order by s.created_at), '[]'::jsonb)
               from public.shares s where s.user_id = auth.uid()),
    'share_reports', (select coalesce(jsonb_agg(jsonb_build_object('share_id', r.share_id, 'kind', r.kind, 'reason', r.reason, 'created_at', r.created_at) order by r.id), '[]'::jsonb)
                      from public.share_reports r where r.reporter = auth.uid()))
$$;

revoke all on function public.sharing_on(), public.set_sharing(boolean), public.share_limits(), public.share_design(text, text, text), public.open_share(uuid), public.my_shares(), public.unshare(uuid), public.report_share(uuid, text, text), public.remove_share(uuid), public.my_data_part_shares() from public, anon, authenticated;
grant execute on function public.share_limits(), public.open_share(uuid), public.report_share(uuid, text, text) to anon, authenticated;
grant execute on function public.share_design(text, text, text), public.my_shares(), public.unshare(uuid) to authenticated;
grant execute on function public.remove_share(uuid), public.set_sharing(boolean) to service_role;
