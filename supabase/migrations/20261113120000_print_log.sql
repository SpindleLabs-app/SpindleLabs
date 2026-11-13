-- Print log (account features 5): the prints a signed-in person made, kept in their account so every device they
-- sign in on shows the same log. A print is a line the app adds when a print file is saved from Slice for printing
-- (the design's name then, the slicer's choices in words, the weight and time it worked out), and what the person
-- later says about it: printed well, failed (with what went wrong from a fixed list) or not said yet, and a short note.
-- Never the design, the print file or anything else about the printer.
--
-- The log works without an account: each browser keeps its own (packages/print print-log.ts). This keeps a copy of
-- the prints made while signed in, for people who leave "Keep my print log in my account" on (profiles.keep_print_log).
-- The browser never writes the table directly: save_prints() checks every print and keeps the later change of two;
-- delete_prints() deletes. supabase/test/test_print_log.py checks every rule here on a real PostgreSQL.

-- Off switch, per person, followed on every device. On by default, like keeping designs and settings.
alter table public.profiles add column keep_print_log boolean not null default true;

create table public.print_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The app's random id for the print (a UUID made in the browser), so devices name the same print.
  id uuid not null,
  -- When the print file was saved, the design's name then, and the slicer's choices in words.
  made_at timestamptz not null,
  name text not null check (char_length(name) between 1 and 100),
  settings text not null check (char_length(settings) <= 200),
  -- What the slicer worked out: grams of filament and minutes of printing (null when it gave none).
  grams numeric check (grams is null or (grams >= 0 and grams <= 100000)),
  minutes integer check (minutes is null or (minutes >= 0 and minutes <= 100000)),
  -- What the person said: waiting (not said yet), well or failed; what went wrong only when failed.
  result text not null check (result in ('waiting', 'well', 'failed')),
  problem text check (problem is null or (result = 'failed' and problem in ('came-off', 'warped', 'stringing', 'layer-shift', 'spaghetti', 'supports', 'gaps', 'wrong-size', 'stopped', 'other'))),
  note text not null default '' check (char_length(note) <= 500),
  -- When it last changed on the device that changed it (never later than when it reached the account): of two
  -- devices' changes to one print, the later is kept.
  updated_at timestamptz not null,
  primary key (user_id, id)
);

revoke all on public.print_log from anon, authenticated;
alter table public.print_log enable row level security;
-- Reading is through the functions below; this policy is the second lock behind them, should a grant ever be added.
create policy "own prints only" on public.print_log for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The limits, in one place so the app and the tests read the same numbers: 500 prints a person, 50 a save, a name
-- of 100 characters, the settings' words 200, a note 500.
create function public.print_log_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('max_prints', 500, 'max_batch', 50, 'max_name', 100, 'max_settings', 200, 'max_note', 500)
$$;

-- One print as the app sends and reads it.
create function public.print_log_json(p public.print_log) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'made_at', p.made_at, 'name', p.name, 'settings', p.settings, 'grams', p.grams,
    'minutes', p.minutes, 'result', p.result, 'problem', p.problem, 'note', p.note, 'updated_at', p.updated_at)
$$;

-- The person's log: {"keep": bool, "prints": [...]}, newest made first.
create function public.my_print_log() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  keep boolean;
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  select keep_print_log into keep from public.profiles where id = me;
  return jsonb_build_object('keep', coalesce(keep, false), 'prints', coalesce(
    (select jsonb_agg(public.print_log_json(p) order by p.made_at desc, p.id) from public.print_log p where p.user_id = me), '[]'::jsonb));
end $$;

-- A time the app sent, or null when it isn't one (ISO 8601 with its offset, as the app's toISOString writes).
create function public.print_log_time(p_text text) returns timestamptz
language plpgsql immutable set search_path = '' as $$
begin
  if p_text is null or p_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    return null;
  end if;
  return p_text::timestamptz;
exception when others then
  return null;
end $$;

-- Whether one print is as print_log_json gives it and within the limits. Each test in turn (SQL's OR may run its
-- parts in any order, and a cast of a bad value would raise).
create function public.print_log_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  lim jsonb := public.print_log_limits();
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('id', 'made_at', 'name', 'settings', 'grams', 'minutes', 'result', 'problem', 'note', 'updated_at')) then return false; end if;
  if jsonb_typeof(p->'id') is distinct from 'string' or (p->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if jsonb_typeof(p->'made_at') is distinct from 'string' or public.print_log_time(p->>'made_at') is null then return false; end if;
  if jsonb_typeof(p->'updated_at') is distinct from 'string' or public.print_log_time(p->>'updated_at') is null then return false; end if;
  if jsonb_typeof(p->'name') is distinct from 'string' or char_length(p->>'name') not between 1 and (lim->>'max_name')::integer then return false; end if;
  if jsonb_typeof(p->'settings') is distinct from 'string' or char_length(p->>'settings') > (lim->>'max_settings')::integer then return false; end if;
  if jsonb_typeof(p->'note') is distinct from 'string' or char_length(p->>'note') > (lim->>'max_note')::integer then return false; end if;
  if coalesce(jsonb_typeof(p->'grams'), 'null') not in ('null', 'number') then return false; end if;
  if jsonb_typeof(p->'grams') = 'number' and (p->>'grams')::numeric not between 0 and 100000 then return false; end if;
  if coalesce(jsonb_typeof(p->'minutes'), 'null') not in ('null', 'number') then return false; end if;
  if jsonb_typeof(p->'minutes') = 'number' and (p->>'minutes') !~ '^[0-9]{1,6}$' then return false; end if;
  if jsonb_typeof(p->'minutes') = 'number' and (p->>'minutes')::integer > 100000 then return false; end if;
  if jsonb_typeof(p->'result') is distinct from 'string' or (p->>'result') not in ('waiting', 'well', 'failed') then return false; end if;
  if coalesce(jsonb_typeof(p->'problem'), 'null') not in ('null', 'string') then return false; end if;
  if jsonb_typeof(p->'problem') = 'string' and ((p->>'result') <> 'failed' or (p->>'problem') not in ('came-off', 'warped', 'stringing', 'layer-shift', 'spaghetti', 'supports', 'gaps', 'wrong-size', 'stopped', 'other')) then return false; end if;
  return true;
end $$;

-- Keeps the prints in p_prints (a JSON array of at most 50), each as the person's own. A print the account already
-- has is replaced only when this one changed later; a new one is added while the person has fewer than 500.
-- Answers, never raising for these:
--   {"status": "done", "saved": [ids], "older": [ids], "full": [ids]}
--       saved: written; older: the account's copy changed later, so it stays; full: new, but 500 are kept already
--   {"status": "invalid"}   not an array of at most 50 prints each as print_log_json gives them: nothing written
--   {"status": "off"}       the person turned off keeping their print log
create function public.save_prints(p_prints jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  lim jsonb := public.print_log_limits();
  keep boolean;
  item jsonb;
  pid uuid;
  made timestamptz;
  changed timestamptz;
  stored timestamptz;
  n integer;
  saved jsonb := '[]'::jsonb;
  older jsonb := '[]'::jsonb;
  full_ jsonb := '[]'::jsonb;
  seen uuid[] := '{}';
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  -- One save at a time per person, so the count of 500 holds.
  select keep_print_log into keep from public.profiles where id = me for update;
  if keep is distinct from true then
    return jsonb_build_object('status', 'off');
  end if;
  if p_prints is null or jsonb_typeof(p_prints) <> 'array' or jsonb_array_length(p_prints) > (lim->>'max_batch')::integer then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- Every print checked before any is written: one bad print refuses the whole save.
  for item in select value from jsonb_array_elements(p_prints) loop
    if not public.print_log_valid(item) then
      return jsonb_build_object('status', 'invalid');
    end if;
    pid := (item->>'id')::uuid;
    if pid = any(seen) then
      return jsonb_build_object('status', 'invalid');
    end if;
    seen := seen || pid;
  end loop;
  for item in select value from jsonb_array_elements(p_prints) loop
    pid := (item->>'id')::uuid;
    -- A device's clock ahead of the server's can't make its change win for good: never later than now.
    made := least(public.print_log_time(item->>'made_at'), now());
    changed := least(public.print_log_time(item->>'updated_at'), now());
    select updated_at into stored from public.print_log where user_id = me and id = pid;
    if found then
      if changed > stored then
        update public.print_log set made_at = made, name = item->>'name', settings = item->>'settings',
          grams = (item->>'grams')::numeric, minutes = (item->>'minutes')::integer, result = item->>'result',
          problem = item->>'problem', note = item->>'note', updated_at = changed
          where user_id = me and id = pid;
        saved := saved || to_jsonb(pid);
      else
        older := older || to_jsonb(pid);
      end if;
    else
      select count(*) into n from public.print_log where user_id = me;
      if n >= (lim->>'max_prints')::integer then
        full_ := full_ || to_jsonb(pid);
      else
        insert into public.print_log (user_id, id, made_at, name, settings, grams, minutes, result, problem, note, updated_at)
          values (me, pid, made, item->>'name', item->>'settings', (item->>'grams')::numeric, (item->>'minutes')::integer,
            item->>'result', item->>'problem', item->>'note', changed);
        saved := saved || to_jsonb(pid);
      end if;
    end if;
  end loop;
  return jsonb_build_object('status', 'done', 'saved', saved, 'older', older, 'full', full_);
end $$;

-- Deletes the person's prints with these ids (at most 500 at once); gives how many there were. Works while keeping
-- is off too (there are none then).
create function public.delete_prints(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) > (public.print_log_limits()->>'max_prints')::integer then
    raise exception 'at most 500 prints at once';
  end if;
  delete from public.print_log where user_id = auth.uid() and id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- Turns keeping the print log on or off on every device. Off deletes the prints kept in the account straight away
-- (each browser keeps its own log). Gives the choice now.
create function public.set_keep_print_log(p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  update public.profiles set keep_print_log = (p_on is true) where id = me;
  if p_on is not true then
    delete from public.print_log where user_id = me;
  end if;
  return p_on is true;
end $$;

-- Deletes every print kept in the person's account (the browsers' own logs stay); true when there were some.
create function public.delete_my_print_log() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.print_log where user_id = auth.uid();
  return found;
end $$;

-- Download my data's part (see my_data in 20261105120000_my_designs.sql): every print kept, newest made first.
create function public.my_data_part_print_log() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('print_log', coalesce((select jsonb_agg(public.print_log_json(p) order by p.made_at desc, p.id) from public.print_log p where p.user_id = auth.uid()), '[]'::jsonb))
$$;

revoke all on function public.print_log_limits(), public.print_log_json(public.print_log), public.my_print_log(), public.print_log_time(text), public.print_log_valid(jsonb), public.save_prints(jsonb), public.delete_prints(uuid[]), public.set_keep_print_log(boolean), public.delete_my_print_log(), public.my_data_part_print_log() from public, anon, authenticated;
grant execute on function public.print_log_limits(), public.my_print_log(), public.save_prints(jsonb), public.delete_prints(uuid[]), public.set_keep_print_log(boolean), public.delete_my_print_log() to authenticated;
