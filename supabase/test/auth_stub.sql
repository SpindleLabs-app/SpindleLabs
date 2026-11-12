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
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Supabase Storage's tables, as far as the library (community C3) relies on them. Storage itself runs every upload,
-- download link and delete as the person's own role with row level security on storage.objects, setting owner_id to
-- the person's id and metadata's size to the file's bytes; the tests do the same by inserting as that role.
create schema storage;
create table storage.buckets (id text primary key, name text not null unique, owner uuid, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(), version text, unique (bucket_id, name));
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
