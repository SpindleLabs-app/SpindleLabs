-- The bug report log's id counter, closed to the browser (security hunt 2026-11-13).
--
-- Supabase's default grants give anon and authenticated ALL on every new sequence. The
-- shares, moderation and likes migrations closed theirs; the bug report log's was left
-- as made. Moved to its end, every later report would be refused. Nothing in the browser
-- reads or moves it: only bug_report_allowed (service_role, definer) inserts into the log.
-- test/test_sequences.py checks every counter in the schema, so a later one can't be missed.

revoke all on sequence public.bug_report_log_id_seq from anon, authenticated;
