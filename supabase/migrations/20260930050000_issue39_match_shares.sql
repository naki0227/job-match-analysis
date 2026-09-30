-- Issue #39: owner-created public links to a projection of one personal Match.
-- The projection is stored at creation so public reads never join private rows.
begin;

create table public.match_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_result_id uuid not null
    references public.match_results(id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  projection jsonb not null check (
    pg_catalog.jsonb_typeof(projection) = 'object'
    and projection ?& array['companyName', 'jobTitle', 'evaluatedAt', 'axes']
    and pg_catalog.jsonb_typeof(projection -> 'axes') = 'array'
    and pg_catalog.jsonb_array_length(projection -> 'axes') = 8
  ),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= created_at)
);

-- At most one live link per Match; revoked links stay as history.
create unique index match_shares_active_match_idx
  on public.match_shares (match_result_id) where revoked_at is null;
create index match_shares_user_idx on public.match_shares (user_id);

alter table public.match_shares enable row level security;
revoke all on public.match_shares from public, anon, authenticated;
grant select, insert, update on public.match_shares to service_role;

create function public.create_match_share(
  p_user_id uuid,
  p_match_result_id uuid,
  p_token text,
  p_projection jsonb
)
returns table (share_id uuid, token text, created_at timestamptz, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_share public.match_shares%rowtype;
begin
  if p_user_id is null or p_match_result_id is null then
    raise exception 'invalid_match_share' using errcode = '22023';
  end if;
  -- Locking the owner's Match serializes concurrent requests for one link.
  perform 1 from public.match_results m
  where m.id = p_match_result_id and m.user_id = p_user_id
  for update;
  if not found then
    raise exception 'match_not_owned' using errcode = '22023';
  end if;

  select * into v_share from public.match_shares s
  where s.match_result_id = p_match_result_id and s.revoked_at is null;
  if found then
    return query select v_share.id, v_share.token, v_share.created_at, false;
    return;
  end if;

  insert into public.match_shares (user_id, match_result_id, token, projection)
  values (p_user_id, p_match_result_id, p_token, p_projection)
  returning * into v_share;
  return query select v_share.id, v_share.token, v_share.created_at, true;
end;
$$;

create function public.read_active_match_share(
  p_user_id uuid,
  p_match_result_id uuid
)
returns table (share_id uuid, token text, created_at timestamptz, projection jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.token, s.created_at, s.projection
  from public.match_shares s
  where s.user_id = p_user_id and s.match_result_id = p_match_result_id
    and s.revoked_at is null;
$$;

-- Returns true when the caller owns the link; revoking twice is harmless.
create function public.revoke_match_share(p_user_id uuid, p_share_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.match_shares
  set revoked_at = coalesce(revoked_at, now())
  where id = p_share_id and user_id = p_user_id;
  return found;
end;
$$;

-- Anonymous readers see only live projections, never owners or Match IDs.
create function public.read_public_share(p_token text)
returns table (created_at timestamptz, projection jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.created_at, s.projection
  from public.match_shares s
  where s.token = p_token and s.revoked_at is null;
$$;

revoke all on function public.create_match_share(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.read_active_match_share(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_match_share(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.read_public_share(text)
  from public, anon, authenticated;
grant execute on function public.create_match_share(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.read_active_match_share(uuid, uuid)
  to service_role;
grant execute on function public.revoke_match_share(uuid, uuid) to service_role;
grant execute on function public.read_public_share(text) to service_role;

commit;
