-- Report a bug's limits, tightened after the security review of 2026-11-11 (20261111000000_bug_reports.sql is
-- applied, so it stays as it is). At 5 an hour alone, one sender could take 115 of the day's 200 places, and designs
-- had no daily total. Now bug_report_allowed(sender, bytes) also allows at most 15 reports a day per sender and
-- 100 MiB of designs a day in all; `bytes` is the design's size in UTF-8 bytes (0 without one). The version without
-- a size is dropped, so a function not yet updated is refused rather than let through unlimited.
-- supabase/test/test_bug_reports.py checks every rule here on a real PostgreSQL.

alter table public.bug_report_log add column bytes bigint not null default 0 check (bytes >= 0);

drop function public.bug_report_allowed(text);

create or replace function public.bug_report_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('per_sender_hour', 5, 'per_sender_day', 15, 'all_day', 200, 'design_bytes_day', 100 * 1024 * 1024)
$$;

-- Whether `p_sender` may send a report with a design of `p_bytes` now; a yes is counted, a no is not.
create function public.bug_report_allowed(p_sender text, p_bytes bigint) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  lim jsonb := public.bug_report_limits();
begin
  if p_sender is null or p_sender !~ '^[0-9a-f]{64}$' then
    raise exception 'not a sender hash';
  end if;
  if p_bytes is null or p_bytes < 0 then
    raise exception 'not a size';
  end if;
  -- One caller at a time, so two reports at once can't both take the last place.
  perform pg_advisory_xact_lock(hashtext('public.bug_report_allowed'));
  delete from public.bug_report_log where at < now() - interval '1 day';
  if (select count(*) from public.bug_report_log where sender = p_sender and at > now() - interval '1 hour') >= (lim ->> 'per_sender_hour')::int
     or (select count(*) from public.bug_report_log where sender = p_sender) >= (lim ->> 'per_sender_day')::int
     or (select count(*) from public.bug_report_log) >= (lim ->> 'all_day')::int
     or (select coalesce(sum(bytes), 0) from public.bug_report_log) + p_bytes > (lim ->> 'design_bytes_day')::bigint then
    return false;
  end if;
  insert into public.bug_report_log (sender, bytes) values (p_sender, p_bytes);
  return true;
end;
$$;

revoke execute on function public.bug_report_limits(), public.bug_report_allowed(text, bigint) from public, anon, authenticated;
grant execute on function public.bug_report_allowed(text, bigint) to service_role;
