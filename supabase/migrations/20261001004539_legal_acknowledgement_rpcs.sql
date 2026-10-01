-- ADR-046 (on ADR-022): the legal consent flow. Documents and acknowledgement
-- events stay immutable; these server-only functions read the current
-- versions and record a user's explicit acknowledgement of exactly those
-- versions. Clients still have no write privileges.
begin;

-- The latest version of each document type that is both published and in
-- effect at p_at. A version published or effective later is not current.
-- Taking the time as a parameter lets tests check a release date exactly.
create function public.legal_documents_current_at(p_at timestamptz)
returns table (
  id uuid,
  document_type text,
  version text,
  body_markdown text,
  published_at timestamptz,
  effective_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (d.document_type)
    d.id, d.document_type, d.version, d.body_markdown,
    d.published_at, d.effective_at
  from public.legal_documents d
  where d.published_at <= p_at and d.effective_at <= p_at
  order by d.document_type, d.effective_at desc, d.published_at desc, d.id desc;
$$;

create function public.current_legal_documents()
returns table (
  id uuid,
  document_type text,
  version text,
  body_markdown text,
  published_at timestamptz,
  effective_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.legal_documents_current_at(now());
$$;

-- For each current document: whether this user recorded the required action
-- (terms: accepted, privacy policy: acknowledged) for that exact version.
create function public.legal_acknowledgement_status(p_user_id uuid)
returns table (
  document_type text,
  legal_document_id uuid,
  version text,
  effective_at timestamptz,
  recorded_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.document_type, c.id, c.version, c.effective_at, a.recorded_at
  from public.current_legal_documents() c
  left join public.user_legal_acknowledgements a
    on a.legal_document_id = c.id
    and a.user_id = p_user_id
    and a.action = case c.document_type
      when 'terms' then 'accepted' else 'acknowledged' end
  order by c.document_type;
$$;

-- Records both acknowledgements, only for the versions that are current now.
-- The action per document is fixed here, never chosen by the client.
-- Re-sending the same versions is a no-op.
create function public.record_legal_acknowledgements(
  p_user_id uuid,
  p_terms_document_id uuid,
  p_privacy_document_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_terms uuid;
  v_privacy uuid;
begin
  if p_user_id is null or p_terms_document_id is null
    or p_privacy_document_id is null then
    raise exception 'invalid_legal_acknowledgement' using errcode = '22023';
  end if;
  select id into v_terms from public.current_legal_documents()
    where document_type = 'terms';
  select id into v_privacy from public.current_legal_documents()
    where document_type = 'privacy_policy';
  if v_terms is null or v_privacy is null then
    raise exception 'legal_documents_unavailable' using errcode = 'P0503';
  end if;
  if p_terms_document_id <> v_terms or p_privacy_document_id <> v_privacy then
    raise exception 'legal_document_outdated' using errcode = 'P0409';
  end if;
  insert into public.user_legal_acknowledgements(user_id, legal_document_id, action)
  values (p_user_id, v_terms, 'accepted'), (p_user_id, v_privacy, 'acknowledged')
  on conflict (user_id, legal_document_id, action) do nothing;
end;
$$;

-- The user's own acknowledgement history, newest first.
create function public.list_legal_acknowledgements(p_user_id uuid)
returns table (
  document_type text,
  version text,
  action text,
  recorded_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.document_type, d.version, a.action, a.recorded_at
  from public.user_legal_acknowledgements a
  join public.legal_documents d on d.id = a.legal_document_id
  where a.user_id = p_user_id
  order by a.recorded_at desc, d.document_type
  limit 100;
$$;

revoke all on function public.legal_documents_current_at(timestamptz)
  from public, anon, authenticated;
revoke all on function public.current_legal_documents()
  from public, anon, authenticated;
revoke all on function public.legal_acknowledgement_status(uuid)
  from public, anon, authenticated;
revoke all on function public.record_legal_acknowledgements(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.list_legal_acknowledgements(uuid)
  from public, anon, authenticated;
grant execute on function public.legal_documents_current_at(timestamptz)
  to service_role;
grant execute on function public.current_legal_documents() to service_role;
grant execute on function public.legal_acknowledgement_status(uuid) to service_role;
grant execute on function public.record_legal_acknowledgements(uuid, uuid, uuid)
  to service_role;
grant execute on function public.list_legal_acknowledgements(uuid) to service_role;

commit;
