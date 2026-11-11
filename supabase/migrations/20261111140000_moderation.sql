-- Moderation, first piece (community step C5a): what the people who run SpindleLabs need to act on reports, all of
-- it server only (service_role: the dashboard's SQL editor or a later admin page), never the browser.
--   * The review list: every link with reports not yet looked at, most reported first.
--   * A decision on a link: take it down, put it back, or dismiss the reports, each kept in the moderation record.
--   * Holding an account: it can't make links or change its name until the hold ends (or ever, for a closed one).
--   * Copyright claims (the takedown process): each claim, what was done and when.
--   * The moderation record: every decision, who made it and why, kept even after the account it was about goes
--     (by id only then), as the record a host may have to show.
-- The rules for what to take down are the content rules, a PLACEHOLDER until the legal check.
-- supabase/test/test_moderation.py checks every rule here against a real PostgreSQL.

alter table public.share_reports add column reviewed_at timestamptz;
create index share_reports_open on public.share_reports (share_id) where reviewed_at is null;

create table public.moderation_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null check (action in ('take-down', 'put-back', 'dismiss', 'reset-name', 'hold', 'end-hold', 'claim')),
  -- What it was about: a link's id, or a person's (no foreign keys: the record outlives both).
  share_id uuid,
  user_id uuid,
  -- Who decided (their own name or initials) and why, in their words.
  moderator text not null check (char_length(moderator) between 1 and 100),
  note text not null check (char_length(note) <= 2000)
);
revoke all on public.moderation_log from anon, authenticated;
alter table public.moderation_log enable row level security;

-- A hold on an account: no new links and no name changes until `until` (null: closed for good). One per person.
create table public.account_holds (
  user_id uuid primary key references auth.users (id) on delete cascade,
  since timestamptz not null default now(),
  until timestamptz,
  -- Shown to the person in Download my data: the plain reason, in words they can read.
  reason text not null check (char_length(reason) between 1 and 500)
);
revoke all on public.account_holds from anon, authenticated;
alter table public.account_holds enable row level security;

-- Copyright claims sent in by email (the takedown process, a PLACEHOLDER until the legal check).
create table public.takedown_claims (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  share_id uuid not null,
  claimant text not null check (char_length(claimant) between 1 and 200),
  contact text not null check (char_length(contact) between 1 and 200),
  work text not null check (char_length(work) between 1 and 2000),
  -- 'open' until decided: 'upheld' (the link stays down) or 'rejected' (put back).
  outcome text not null default 'open' check (outcome in ('open', 'upheld', 'rejected')),
  decided_at timestamptz
);
revoke all on public.takedown_claims from anon, authenticated;
alter table public.takedown_claims enable row level security;

-- True when the account may not make links or change its name now.
create function public.account_held(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select from public.account_holds h where h.user_id = p_user and (h.until is null or h.until > now()))
$$;

-- The hold, enforced where the rows are written, so no function (now or later) can forget it.
create function public.refuse_held_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.account_held(new.user_id) then
    raise exception 'account held' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger shares_refuse_held before insert on public.shares for each row execute function public.refuse_held_account();
create trigger display_names_refuse_held before insert or update on public.display_names for each row execute function public.refuse_held_account();

-- The review list: each link with reports nobody has looked at yet, most reported first, then the oldest report.
create function public.review_queue() returns table (share_id uuid, name text, owner uuid, open_reports bigint, kinds text[], first_report timestamptz, removed_at timestamptz, off_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.share_id, s.name, s.user_id, count(*), array_agg(distinct r.kind order by r.kind), min(r.created_at), s.removed_at, s.off_at
  from public.share_reports r left join public.shares s on s.id = r.share_id
  where r.reviewed_at is null
  group by r.share_id, s.name, s.user_id, s.removed_at, s.off_at
  order by count(*) desc, min(r.created_at), r.share_id
$$;

-- A decision on a link's reports: 'take-down' (nobody can open it), 'put-back' (it opens again, if its owner hasn't
-- turned it off) or 'dismiss' (nothing changes). Every open report on it is marked looked at, and the decision is
-- kept in the record. False (and nothing kept) for a link that never was, or a decision that changes nothing
-- (taking down a link already down, putting back one that isn't).
create function public.decide_share(p_id uuid, p_action text, p_moderator text, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  s public.shares;
begin
  if p_action not in ('take-down', 'put-back', 'dismiss') then
    raise exception 'unknown decision %', p_action;
  end if;
  select * into s from public.shares where id = p_id for update;
  if not found then
    return false;
  end if;
  if p_action = 'take-down' then
    if s.removed_at is not null then
      return false;
    end if;
    update public.shares set removed_at = now() where id = p_id;
  elsif p_action = 'put-back' then
    if s.removed_at is null then
      return false;
    end if;
    update public.shares set removed_at = null where id = p_id;
  end if;
  update public.share_reports set reviewed_at = now() where share_id = p_id and reviewed_at is null;
  insert into public.moderation_log (action, share_id, user_id, moderator, note) values (p_action, p_id, s.user_id, p_moderator, coalesce(p_note, ''));
  return true;
end $$;

-- Takes a display name away (they pick another, at once), kept in the record. False when they had none.
create function public.moderate_name(p_user uuid, p_moderator text, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.reset_display_name(p_user) then
    return false;
  end if;
  insert into public.moderation_log (action, user_id, moderator, note) values ('reset-name', p_user, p_moderator, coalesce(p_note, ''));
  return true;
end $$;

-- Holds an account until p_until (null: closed for good), replacing any hold it has, and takes every link of
-- theirs that is up down too when p_take_links. Kept in the record. False for an account that doesn't exist.
create function public.hold_account(p_user uuid, p_until timestamptz, p_reason text, p_take_links boolean, p_moderator text, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select from auth.users u where u.id = p_user) then
    return false;
  end if;
  insert into public.account_holds (user_id, until, reason) values (p_user, p_until, p_reason)
    on conflict (user_id) do update set since = now(), until = excluded.until, reason = excluded.reason;
  if p_take_links then
    update public.shares set removed_at = now() where user_id = p_user and removed_at is null and off_at is null;
  end if;
  insert into public.moderation_log (action, user_id, moderator, note) values ('hold', p_user, p_moderator, coalesce(p_note, ''));
  return true;
end $$;

-- Ends a hold early, kept in the record. False when there was none.
create function public.end_hold(p_user uuid, p_moderator text, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.account_holds where user_id = p_user;
  if not found then
    return false;
  end if;
  insert into public.moderation_log (action, user_id, moderator, note) values ('end-hold', p_user, p_moderator, coalesce(p_note, ''));
  return true;
end $$;

-- Records a copyright claim and takes the link down while it is looked at (the takedown process). The claim's id.
create function public.record_claim(p_share uuid, p_claimant text, p_contact text, p_work text, p_moderator text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  claim_id bigint;
  owner uuid;
begin
  insert into public.takedown_claims (share_id, claimant, contact, work) values (p_share, p_claimant, p_contact, p_work) returning id into claim_id;
  update public.shares set removed_at = coalesce(removed_at, now()) where id = p_share returning user_id into owner;
  insert into public.moderation_log (action, share_id, user_id, moderator, note) values ('claim', p_share, owner, p_moderator, 'claim ' || claim_id || ' received; link down while it is looked at');
  return claim_id;
end $$;

-- Decides a claim: 'upheld' leaves the link down, 'rejected' puts it back. Kept in the record. False for a claim
-- already decided or never made.
create function public.decide_claim(p_claim bigint, p_outcome text, p_moderator text, p_note text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  c public.takedown_claims;
begin
  if p_outcome not in ('upheld', 'rejected') then
    raise exception 'unknown outcome %', p_outcome;
  end if;
  select * into c from public.takedown_claims where id = p_claim and outcome = 'open' for update;
  if not found then
    return false;
  end if;
  update public.takedown_claims set outcome = p_outcome, decided_at = now() where id = p_claim;
  if p_outcome = 'rejected' then
    perform public.decide_share(c.share_id, 'put-back', p_moderator, 'claim ' || p_claim || ' rejected: ' || coalesce(p_note, ''));
  else
    perform public.decide_share(c.share_id, 'dismiss', p_moderator, 'claim ' || p_claim || ' upheld: ' || coalesce(p_note, ''));
  end if;
  return true;
end $$;

-- Moderation's part of Download my data: a hold on the account, and every decision about the person or their links
-- (what and when, never who decided or the reporters).
create function public.my_data_part_moderation() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'account_hold', (select jsonb_build_object('since', h.since, 'until', h.until, 'reason', h.reason) from public.account_holds h where h.user_id = auth.uid()),
    'moderation', (select coalesce(jsonb_agg(jsonb_build_object('at', m.at, 'action', m.action, 'share_id', m.share_id) order by m.id), '[]'::jsonb)
                   from public.moderation_log m where m.user_id = auth.uid()))
$$;

revoke all on function public.account_held(uuid), public.refuse_held_account(), public.review_queue(), public.decide_share(uuid, text, text, text), public.moderate_name(uuid, text, text), public.hold_account(uuid, timestamptz, text, boolean, text, text), public.end_hold(uuid, text, text), public.record_claim(uuid, text, text, text, text), public.decide_claim(bigint, text, text, text), public.my_data_part_moderation() from public, anon, authenticated;
grant execute on function public.review_queue(), public.decide_share(uuid, text, text, text), public.moderate_name(uuid, text, text), public.hold_account(uuid, timestamptz, text, boolean, text, text), public.end_hold(uuid, text, text), public.record_claim(uuid, text, text, text, text), public.decide_claim(bigint, text, text, text) to service_role;
