-- Assertions run only against the separate restored PostgreSQL container.
do $$
begin
  if (select count(*) from auth.users) <> 2
    or (select count(*) from public.assessment_axes) <> 8
    or (select count(*) from public.career_profile_versions
        where user_id = '00000000-0000-0000-0000-000000003101') <> 2
    or (select count(*) from public.career_profile_axis_values) <> 24
    or (select count(*) from public.companies where name = 'Dummy Company') <> 1
    or (select count(*) from public.user_legal_acknowledgements) <> 1 then
    raise exception 'Restored data or version history is incomplete';
  end if;
  if (select full_remote_required from public.career_constraints c
      join public.career_profile_versions v on v.id = c.profile_version_id
      where v.user_id = '00000000-0000-0000-0000-000000003101'
        and v.version = 1) is distinct from false
    or (select full_remote_required from public.career_constraints c
      join public.career_profile_versions v on v.id = c.profile_version_id
      where v.user_id = '00000000-0000-0000-0000-000000003101'
        and v.version = 2) is distinct from true then
    raise exception 'Restored profile revisions lost their constraint values';
  end if;
  if not (select relrowsecurity from pg_class
      where oid = 'public.profile_educations'::regclass) then
    raise exception 'Restored private table lost RLS';
  end if;
  begin
    insert into public.profile_educations(user_id, institution_name)
    values ('00000000-0000-0000-0000-000000003199', 'Orphan');
    raise exception 'Restored foreign key accepted orphan';
  exception when foreign_key_violation then null;
  end;
end;
$$;

begin;
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000003101', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.profiles) <> 1
    or (select count(*) from public.career_profile_versions) <> 2
    or (select count(*) from public.profile_educations) <> 1
    or (select count(*) from public.user_legal_acknowledgements) <> 1 then
    raise exception 'Restored owner RLS does not isolate users';
  end if;
end;
$$;
rollback;

begin;
set local role anon;
do $$
begin
  if (select count(*) from public.legal_documents
      where id = '31000000-0000-0000-0000-000000000005') <> 1
    or (select count(*) from public.legal_documents
      where version = '1.0'
        and document_type in ('terms', 'privacy_policy')
        and published_at <= now()
        and effective_at <= now()) <> 2 then
    raise exception 'Published legal documents are not visible after restore';
  end if;
end;
$$;
rollback;
