-- Issue #38: additive schema, constraints, ownership, and published documents.
begin;

create function pg_temp.expect_sqlstate(statement text, expected text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'Expected SQLSTATE %, but statement succeeded: %', expected, statement;
exception when others then
  if sqlstate = expected then return; end if;
  raise;
end;
$$;

insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000003801'),
  ('00000000-0000-0000-0000-000000003802');
insert into public.profiles(id) values
  ('00000000-0000-0000-0000-000000003801'),
  ('00000000-0000-0000-0000-000000003802');

do $$
begin
  if (select count(*) from public.profiles
      where id in ('00000000-0000-0000-0000-000000003801',
                   '00000000-0000-0000-0000-000000003802')
        and display_name is null and full_name is null
        and contact_email is null and contact_phone is null) <> 2 then
    raise exception 'Existing profiles did not keep optional fields null';
  end if;
end;
$$;

update public.profiles set
  display_name = 'Applicant A', full_name = 'Test Person',
  contact_email = 'contact@example.org', contact_phone = '+81-90-0000-0000'
where id = '00000000-0000-0000-0000-000000003801';

insert into public.profile_educations
  (id, user_id, institution_name, faculty, department, started_on, ended_on)
values
  ('38000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000003801',
   'University A', 'Engineering', 'Computer Science', '2020-04-01', '2024-03-31'),
  ('38000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000003801',
   'Graduate School A', null, null, null, null),
  ('38000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000003802',
   'College B', null, null, null, null);

do $$
begin
  if (select count(*) from public.profile_educations
      where user_id = '00000000-0000-0000-0000-000000003801') <> 2
    or (select verification_status from public.profile_educations
        where id = '38000000-0000-0000-0000-000000000001') <> 'self_reported' then
    raise exception 'Education cardinality or default verification failed';
  end if;
end;
$$;

select pg_temp.expect_sqlstate($sql$
  insert into public.profile_educations(user_id, institution_name)
  values ('00000000-0000-0000-0000-000000003801', '   ')
$sql$, '23514');
select pg_temp.expect_sqlstate($sql$
  insert into public.profile_educations(user_id, institution_name, started_on, ended_on)
  values ('00000000-0000-0000-0000-000000003801', 'Bad Dates', '2024-01-01', '2023-01-01')
$sql$, '23514');
select pg_temp.expect_sqlstate($sql$
  insert into public.profile_educations(user_id, institution_name, verification_status)
  values ('00000000-0000-0000-0000-000000003801', 'Bad Status', 'unknown')
$sql$, '23514');
select pg_temp.expect_sqlstate($sql$
  insert into public.profile_educations(user_id, institution_name)
  values ('00000000-0000-0000-0000-000000003899', 'Unknown User')
$sql$, '23503');

insert into public.legal_documents
  (id, document_type, version, body_markdown, published_at, effective_at)
values
  ('38000000-0000-0000-0000-000000000011', 'terms', '2026-09-01',
   '# Terms v1', now() - interval '2 days', now() - interval '1 day'),
  ('38000000-0000-0000-0000-000000000012', 'privacy_policy', '2026-09-01',
   '# Privacy v1', now() - interval '2 days', now() - interval '1 day'),
  ('38000000-0000-0000-0000-000000000013', 'terms', '2026-10-01',
   '# Future Terms', now() + interval '1 day', now() + interval '2 days');

select pg_temp.expect_sqlstate($sql$
  insert into public.legal_documents(document_type, version, body_markdown, published_at, effective_at)
  values ('terms', '2026-09-01', '# duplicate', now(), now())
$sql$, '23505');
select pg_temp.expect_sqlstate($sql$
  insert into public.legal_documents(document_type, version, body_markdown, published_at, effective_at)
  values ('other', 'v1', '# other', now(), now())
$sql$, '23514');
select pg_temp.expect_sqlstate($sql$
  insert into public.legal_documents(document_type, version, body_markdown, published_at, effective_at)
  values ('terms', 'v2', '   ', now(), now())
$sql$, '23514');
select pg_temp.expect_sqlstate($sql$
  insert into public.legal_documents(document_type, version, body_markdown, published_at, effective_at)
  values ('terms', 'v2', '# order', now(), now() - interval '1 day')
$sql$, '23514');

insert into public.user_legal_acknowledgements
  (id, user_id, legal_document_id, action, recorded_at)
values
  ('38000000-0000-0000-0000-000000000021',
   '00000000-0000-0000-0000-000000003801',
   '38000000-0000-0000-0000-000000000011', 'accepted', now()),
  ('38000000-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-000000003801',
   '38000000-0000-0000-0000-000000000012', 'acknowledged', now()),
  ('38000000-0000-0000-0000-000000000023',
   '00000000-0000-0000-0000-000000003802',
   '38000000-0000-0000-0000-000000000011', 'accepted', now());

select pg_temp.expect_sqlstate($sql$
  insert into public.user_legal_acknowledgements(user_id, legal_document_id, action)
  values ('00000000-0000-0000-0000-000000003801',
          '38000000-0000-0000-0000-000000000011', 'accepted')
$sql$, '23505');
select pg_temp.expect_sqlstate($sql$
  insert into public.user_legal_acknowledgements(user_id, legal_document_id, action)
  values ('00000000-0000-0000-0000-000000003801',
          '38000000-0000-0000-0000-000000000099', 'accepted')
$sql$, '23503');
select pg_temp.expect_sqlstate($sql$
  delete from public.legal_documents where id = '38000000-0000-0000-0000-000000000011'
$sql$, '23503');

do $$
begin
  if has_table_privilege('anon', 'public.profile_educations', 'SELECT')
    or has_table_privilege('anon', 'public.user_legal_acknowledgements', 'SELECT')
    or has_table_privilege('authenticated', 'public.profile_educations', 'INSERT')
    or has_table_privilege('authenticated', 'public.user_legal_acknowledgements', 'UPDATE')
    or has_table_privilege('service_role', 'public.legal_documents', 'UPDATE')
    or has_table_privilege('service_role', 'public.user_legal_acknowledgements', 'DELETE') then
    raise exception 'Unexpected client or server write grant';
  end if;
end;
$$;

set local role anon;
select pg_temp.expect_sqlstate('select * from public.profile_educations', '42501');
select pg_temp.expect_sqlstate('select * from public.user_legal_acknowledgements', '42501');
do $$
begin
  if (select count(*) from public.legal_documents) <> 2 then
    raise exception 'Anon can see future legal document';
  end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000003801', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.profile_educations) <> 2
    or (select count(*) from public.user_legal_acknowledgements) <> 2
    or (select count(*) from public.profiles where contact_email = 'contact@example.org') <> 1
    or (select count(*) from public.legal_documents) <> 2 then
    raise exception 'Owner visibility or published document visibility failed';
  end if;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000003802', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.profile_educations) <> 1
    or (select count(*) from public.user_legal_acknowledgements) <> 1
    or exists (select 1 from public.profiles where contact_email = 'contact@example.org') then
    raise exception 'Other user can read private profile, education, or legal history';
  end if;
end;
$$;
reset role;

delete from auth.users
where id = '00000000-0000-0000-0000-000000003802';
do $$
begin
  if exists (select 1 from public.profiles
      where id = '00000000-0000-0000-0000-000000003802')
    or exists (select 1 from public.profile_educations
      where user_id = '00000000-0000-0000-0000-000000003802')
    or exists (select 1 from public.user_legal_acknowledgements
      where user_id = '00000000-0000-0000-0000-000000003802') then
    raise exception 'Private education or legal history survived profile deletion';
  end if;
end;
$$;

rollback;
