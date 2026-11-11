-- Report a bug without a GitHub account: the bug-report function (supabase/functions/bug-report) files each report
-- in a private GitHub repository. Before each one it asks bug_report_allowed(sender), which keeps spam and runaway
-- loops cheap: at most 5 reports an hour from one sender and 200 a day from everyone.
--
-- A sender is a SHA-256 hash (64 lowercase hex characters) of the caller's address with a secret salt, made by the
-- function: the address itself is never stored. Rows older than a day are deleted on every call, so the log only ever
-- holds the last day. Nothing in a browser can read or write it; only the server (service_role) may ask.
-- supabase/test/test_bug_reports.py checks every rule here on a real PostgreSQL.

create table public.bug_report_log (
  id bigint generated always as identity primary key,
  sender text not null check (sender ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now()
);
create index bug_report_log_sender_at on public.bug_report_log (sender, at);
create index bug_report_log_at on public.bug_report_log (at);

revoke all on public.bug_report_log from anon, authenticated;
alter table public.bug_report_log enable row level security;
-- No policies: with row level security on, a grant added by mistake still shows nothing.

-- The limits, in one place so the function's tests and these read the same numbers.
create function public.bug_report_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('per_sender_hour', 5, 'all_day', 200)
$$;

-- Whether `p_sender` may send a report now; a yes is counted, a no is not.
create function public.bug_report_allowed(p_sender text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  lim jsonb := public.bug_report_limits();
begin
  if p_sender is null or p_sender !~ '^[0-9a-f]{64}$' then
    raise exception 'not a sender hash';
  end if;
  -- One caller at a time, so two reports at once can't both take the last place.
  perform pg_advisory_xact_lock(hashtext('public.bug_report_allowed'));
  delete from public.bug_report_log where at < now() - interval '1 day';
  if (select count(*) from public.bug_report_log where sender = p_sender and at > now() - interval '1 hour') >= (lim ->> 'per_sender_hour')::int then
    return false;
  end if;
  if (select count(*) from public.bug_report_log) >= (lim ->> 'all_day')::int then
    return false;
  end if;
  insert into public.bug_report_log (sender) values (p_sender);
  return true;
end;
$$;

revoke execute on function public.bug_report_limits(), public.bug_report_allowed(text) from public, anon, authenticated;
grant execute on function public.bug_report_allowed(text) to service_role;
