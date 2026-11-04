-- The parts of a Supabase database the accounts migration relies on, for
-- testing it on a plain PostgreSQL: the roles the browser uses, auth.users,
-- auth.uid() (the signed-in person, from the request's token), and Supabase's
-- default grants on new public tables and functions (ALL to the browser's
-- roles), which the migration must take back.
-- Roles belong to the whole cluster, so a second database reuses them.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
