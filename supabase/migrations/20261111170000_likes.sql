-- Likes (community step C7): a signed-in person can like a shared design once; everyone sees how many people liked
-- it, never who. A like is on a sharing link (C2), the only design others can open until the public library (C3),
-- which will like its own entries the same way.
--   * One like per person per link (the table's key), never your own link.
--   * The sharing off switch stops liking and hides every count; taking a link down hides its count; turning a link
--     off deletes its likes (nobody can like or open it again, so they are only personal data left behind).
--   * A held account can't like (enforced where the row is written, like links and names), and while it is held its
--     likes don't count: holding a ring of made-up accounts takes their likes off every count at once.
--   * Likes and unlikes together are capped a day per person, so a script can't churn the table.
-- The browser never touches the tables: only the functions below. supabase/test/test_likes.py checks every rule here
-- against a real PostgreSQL.

create table public.share_likes (
  share_id uuid not null references public.shares (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (share_id, user_id)
);
create index share_likes_by_person on public.share_likes (user_id, created_at desc);

revoke all on public.share_likes from anon, authenticated;
alter table public.share_likes enable row level security;
-- No policy: who liked what is never read by the browser, only through the functions below.

-- Each like and unlike in the last day, for the daily cap; a person's rows older than a day go on their next one.
create table public.like_actions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index like_actions_by_person on public.like_actions (user_id, at);
revoke all on public.like_actions from anon, authenticated;
revoke all on sequence public.like_actions_id_seq from anon, authenticated;
alter table public.like_actions enable row level security;

-- A held account can't like (moderation's own trigger function, which reads new.user_id).
create trigger share_likes_refuse_held before insert on public.share_likes for each row execute function public.refuse_held_account();

-- A link turned off takes its likes with it.
create function public.forget_likes_of_link_turned_off() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.share_likes where share_id = new.id;
  return new;
end $$;
create trigger shares_forget_likes after update of off_at on public.shares for each row
  when (old.off_at is null and new.off_at is not null) execute function public.forget_likes_of_link_turned_off();

create function public.like_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('changes_per_day', 300)
$$;

-- How many people like a link, counting only accounts not held now; null when the link is off, taken down or never
-- was, or sharing is switched off. Never says who.
create function public.like_count(p_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (select count(*)::integer from public.share_likes l where l.share_id = s.id and not public.account_held(l.user_id))
  from public.shares s where s.id = p_id and s.off_at is null and s.removed_at is null and public.sharing_on()
$$;

-- Whether the signed-in person likes a link (false for a link they can't open).
create function public.i_like(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select from public.share_likes l join public.shares s on s.id = l.share_id
                 where l.share_id = p_id and l.user_id = auth.uid() and s.off_at is null and s.removed_at is null)
         and public.sharing_on()
$$;

-- Counts one daily change for the signed-in person, forgetting their changes older than a day. False (nothing
-- counted) when they have made as many as a day allows. The caller holds the person's lock.
create function public.take_like_change(me uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  delete from public.like_actions where user_id = me and at <= now() - interval '24 hours';
  select count(*) into n from public.like_actions where user_id = me;
  if n >= (public.like_limits()->>'changes_per_day')::integer then
    return false;
  end if;
  insert into public.like_actions (user_id) values (me);
  return true;
end $$;

-- Likes a link. Answers, never raising for these:
--   "liked"    the like is kept
--   "already"  the person already likes it (nothing changes, nothing counted against the day)
--   "gone"     no link that is on has this id
--   "own"      the person shared it themselves
--   "held"     the person's account is held by moderation
--   "daily"    the person changed as many likes as a day allows
--   "off"      sharing is switched off for everyone
create function public.like_share(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sharer uuid;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if not public.sharing_on() then
    return 'off';
  end if;
  -- The person's lock first: their likes and unlikes go one at a time, so the daily cap holds when they race.
  perform 1 from public.profiles where id = me for update;
  select user_id into sharer from public.shares where id = p_id and off_at is null and removed_at is null;
  if not found then
    return 'gone';
  end if;
  if sharer = me then
    return 'own';
  end if;
  if exists (select from public.share_likes where share_id = p_id and user_id = me) then
    return 'already';
  end if;
  -- One block, so a refused row also takes back the change it counted.
  begin
    if not public.take_like_change(me) then
      return 'daily';
    end if;
    insert into public.share_likes (share_id, user_id) values (p_id, me);
  exception when raise_exception then
    -- A hold on the account (moderation's trigger) refuses the row where it is written.
    if sqlerrm = 'account held' then
      return 'held';
    end if;
    raise;
  end;
  return 'liked';
end $$;

-- Takes the person's like off a link. Works while sharing is off or the person is held (taking something of your
-- own back is always allowed), but counts against the day. Answers "unliked", "not-liked" (nothing changes, nothing
-- counted) or "daily".
create function public.unlike_share(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  perform 1 from public.profiles where id = me for update;
  if not exists (select from public.share_likes where share_id = p_id and user_id = me) then
    return 'not-liked';
  end if;
  if not public.take_like_change(me) then
    return 'daily';
  end if;
  delete from public.share_likes where share_id = p_id and user_id = me;
  return 'unliked';
end $$;

-- Likes' part of Download my data: every link the person likes and when.
create function public.my_data_part_likes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('likes', (select coalesce(jsonb_agg(jsonb_build_object('share_id', l.share_id, 'created_at', l.created_at) order by l.created_at, l.share_id), '[]'::jsonb)
                                      from public.share_likes l where l.user_id = auth.uid()))
$$;

revoke all on function public.forget_likes_of_link_turned_off(), public.like_limits(), public.like_count(uuid), public.i_like(uuid), public.take_like_change(uuid), public.like_share(uuid), public.unlike_share(uuid), public.my_data_part_likes() from public, anon, authenticated;
grant execute on function public.like_limits(), public.like_count(uuid) to anon, authenticated;
grant execute on function public.i_like(uuid), public.like_share(uuid), public.unlike_share(uuid) to authenticated;
