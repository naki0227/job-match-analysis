-- Minimal local stand-in for Supabase Auth roles and auth.uid().
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
-- No blanket table grants: hosted Supabase does not give them to these
-- roles, so every privilege must come from a migration.
