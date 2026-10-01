-- ADR-046: current legal versions and version-pinned acknowledgements.
begin;
-- Isolate from fixtures of earlier tests; everything is rolled back.
delete from public.user_legal_acknowledgements;
delete from public.legal_documents;
insert into auth.users(id) values
  ('46000000-0000-4000-8000-000000000001'),
  ('46000000-0000-4000-8000-000000000002');
insert into public.profiles(id) values
  ('46000000-0000-4000-8000-000000000001'),
  ('46000000-0000-4000-8000-000000000002');

set local role service_role;
do $$
begin
  -- No documents: callers must fail closed.
  if exists (select 1 from public.current_legal_documents()) then
    raise exception 'documents appeared from nowhere';
  end if;
  begin
    perform public.record_legal_acknowledgements(
      '46000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid());
    raise exception 'recorded without documents';
  exception when sqlstate 'P0503' then null;
  end;
end;
$$;
reset role;

insert into public.legal_documents
  (id, document_type, version, body_markdown, published_at, effective_at) values
  ('46100000-0000-4000-8000-000000000001', 'terms', '1.0', '# 利用規約 1.0',
    now() - interval '10 days', now() - interval '10 days'),
  ('46100000-0000-4000-8000-000000000002', 'privacy_policy', '1.0', '# PP 1.0',
    now() - interval '10 days', now() - interval '10 days'),
  -- Published but not yet in effect, and not yet published: not current.
  ('46100000-0000-4000-8000-000000000003', 'terms', '2.0-draft', '# 次の規約',
    now() - interval '1 day', now() + interval '7 days'),
  ('46100000-0000-4000-8000-000000000004', 'privacy_policy', '2.0-draft', '# 次のPP',
    now() + interval '1 day', now() + interval '7 days');

set local role service_role;
do $$
declare
  v_user uuid := '46000000-0000-4000-8000-000000000001';
  v_other uuid := '46000000-0000-4000-8000-000000000002';
  v_terms uuid := '46100000-0000-4000-8000-000000000001';
  v_privacy uuid := '46100000-0000-4000-8000-000000000002';
begin
  if (select array_agg(version order by document_type)
      from public.current_legal_documents()) <> array['1.0', '1.0'] then
    raise exception 'future documents were treated as current';
  end if;
  if exists (select 1 from public.legal_acknowledgement_status(v_user)
      where recorded_at is not null) then
    raise exception 'a new user looks acknowledged';
  end if;

  -- Draft versions and swapped documents are rejected.
  begin
    perform public.record_legal_acknowledgements(
      v_user, '46100000-0000-4000-8000-000000000003', v_privacy);
    raise exception 'a draft version was accepted';
  exception when sqlstate 'P0409' then null;
  end;
  begin
    perform public.record_legal_acknowledgements(v_user, v_privacy, v_terms);
    raise exception 'swapped documents were accepted';
  exception when sqlstate 'P0409' then null;
  end;

  perform public.record_legal_acknowledgements(v_user, v_terms, v_privacy);
  perform public.record_legal_acknowledgements(v_user, v_terms, v_privacy);
  if (select count(*) from public.user_legal_acknowledgements
      where user_id = v_user) <> 2
    or not exists (select 1 from public.user_legal_acknowledgements
      where user_id = v_user and legal_document_id = v_terms and action = 'accepted')
    or not exists (select 1 from public.user_legal_acknowledgements
      where user_id = v_user and legal_document_id = v_privacy and action = 'acknowledged')
    or exists (select 1 from public.legal_acknowledgement_status(v_user)
      where recorded_at is null)
    or exists (select 1 from public.legal_acknowledgement_status(v_other)
      where recorded_at is not null) then
    raise exception 'acknowledgements were not recorded once per version and user';
  end if;
  if (select count(*) from public.list_legal_acknowledgements(v_user)) <> 2
    or exists (select 1 from public.list_legal_acknowledgements(v_other)) then
    raise exception 'history is not per user';
  end if;
end;
$$;
reset role;

-- A new terms version takes effect: the old acceptance no longer counts.
insert into public.legal_documents
  (id, document_type, version, body_markdown, published_at, effective_at) values
  ('46100000-0000-4000-8000-000000000005', 'terms', '1.1', '# 利用規約 1.1',
    now() - interval '1 hour', now() - interval '1 minute');

set local role service_role;
do $$
declare
  v_user uuid := '46000000-0000-4000-8000-000000000001';
begin
  if (select recorded_at from public.legal_acknowledgement_status(v_user)
      where document_type = 'terms') is not null
    or (select recorded_at from public.legal_acknowledgement_status(v_user)
      where document_type = 'privacy_policy') is null then
    raise exception 'old terms acceptance still counted, or privacy was lost';
  end if;
  begin
    perform public.record_legal_acknowledgements(v_user,
      '46100000-0000-4000-8000-000000000001', '46100000-0000-4000-8000-000000000002');
    raise exception 'old terms version was accepted again';
  exception when sqlstate 'P0409' then null;
  end;
  perform public.record_legal_acknowledgements(v_user,
    '46100000-0000-4000-8000-000000000005', '46100000-0000-4000-8000-000000000002');
  if exists (select 1 from public.legal_acknowledgement_status(v_user)
      where recorded_at is null)
    or (select count(*) from public.list_legal_acknowledgements(v_user)) <> 3 then
    raise exception 're-acceptance of the new version was not recorded';
  end if;
end;
$$;
reset role;
rollback;

-- Clients cannot call any of these, and still cannot write the tables.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.legal_documents_current_at(timestamptz)',
    'public.current_legal_documents()',
    'public.legal_acknowledgement_status(uuid)',
    'public.record_legal_acknowledgements(uuid,uuid,uuid)',
    'public.list_legal_acknowledgements(uuid)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
      or has_function_privilege('authenticated', v_fn, 'execute')
      or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'wrong execute privilege on %', v_fn;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.user_legal_acknowledgements', 'INSERT')
    or has_table_privilege('anon', 'public.legal_documents', 'INSERT') then
    raise exception 'clients can write legal tables';
  end if;
end;
$$;
