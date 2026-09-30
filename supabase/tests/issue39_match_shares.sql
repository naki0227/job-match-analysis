-- Issue #39: one live link per Match, owner-only control, revocation, no leaks.
do $$
declare
  v_user uuid := '39000000-0000-4000-8000-000000000001';
  v_other uuid := '39000000-0000-4000-8000-000000000002';
  v_profile uuid := '39000000-0000-4000-8000-000000000003';
  v_company uuid := '39000000-0000-4000-8000-000000000004';
  v_job uuid;
  v_target uuid;
  v_evaluation uuid;
  v_match uuid;
  v_token text := repeat('a', 42) || 'A';
  v_token2 text := repeat('b', 42) || '_';
  v_projection jsonb := jsonb_build_object(
    'companyName', 'Sample Share Co', 'jobTitle', 'Sample Engineer',
    'evaluatedAt', '2026-09-20T00:00:00Z',
    'axes', (select jsonb_agg(jsonb_build_object('axisKey', k, 'status', 'unknown'))
      from unnest(array['work_location', 'autonomy', 'collaboration',
        'growth_direction', 'work_change', 'schedule_flexibility',
        'role_breadth', 'customer_contact']) k));
  v_first record;
  v_second record;
  v_third record;
begin
  insert into auth.users(id) values (v_user), (v_other);
  insert into public.profiles(id) values (v_user), (v_other);
  insert into public.career_profile_versions
    (id, user_id, version, axis_catalog_version, status)
  values (v_profile, v_user, 1, 1, 'completed');
  insert into public.companies(id, name) values (v_company, 'Sample Share Co');
  insert into public.job_postings(company_id, title)
    values (v_company, 'Sample Engineer') returning id into v_job;
  insert into public.evaluation_targets(target_type, company_id, job_posting_id)
    values ('job', v_company, v_job) returning id into v_target;
  insert into public.evaluations
    (target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version)
  values (v_target, 1, 'share-39', 'r1', 'e1', 'm1')
  returning id into v_evaluation;
  insert into public.match_results
    (user_id, career_profile_version_id, evaluation_id,
     axis_catalog_version, algorithm_version)
  values (v_user, v_profile, v_evaluation, 1, 'match-engine-v1')
  returning id into v_match;

  select * into v_first from public.create_match_share(
    v_user, v_match, v_token, v_projection);
  select * into v_second from public.create_match_share(
    v_user, v_match, v_token2, v_projection);
  if not v_first.created or v_second.created
    or v_second.share_id <> v_first.share_id or v_second.token <> v_token
    or (select count(*) from public.match_shares) <> 1 then
    raise exception 'Share creation is not idempotent per Match';
  end if;

  begin
    perform public.create_match_share(v_other, v_match, v_token2, v_projection);
    raise exception 'another user shared the Match';
  exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.read_active_match_share(v_other, v_match)) <> 0
    or (select count(*) from public.read_active_match_share(v_user, v_match)) <> 1
    or public.revoke_match_share(v_other, v_first.share_id) then
    raise exception 'Share visibility or revocation is not owner-only';
  end if;

  if (select projection from public.read_public_share(v_token)) <> v_projection
    or (select count(*) from public.read_public_share(v_token2)) <> 0 then
    raise exception 'Public read returned the wrong projection';
  end if;

  -- Separate statements: a STABLE read in the same expression would not see
  -- the update made by the revoke call.
  if not public.revoke_match_share(v_user, v_first.share_id) then
    raise exception 'Owner could not revoke the link';
  end if;
  if not public.revoke_match_share(v_user, v_first.share_id) then
    raise exception 'Revoking twice failed';
  end if;
  if (select count(*) from public.read_public_share(v_token)) <> 0 then
    raise exception 'Revoked link is still public';
  end if;

  select * into v_third from public.create_match_share(
    v_user, v_match, v_token2, v_projection);
  if not v_third.created or v_third.token <> v_token2
    or (select count(*) from public.read_public_share(v_token2)) <> 1
    or (select count(*) from public.read_public_share(v_token)) <> 0 then
    raise exception 'A new link after revocation did not replace the old one';
  end if;

  delete from public.match_shares where id = v_third.share_id;
  begin
    perform public.create_match_share(v_user, v_match, 'short', v_projection);
    raise exception 'short token accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.create_match_share(v_user, v_match, v_token2,
      v_projection - 'axes');
    raise exception 'projection without axes accepted';
  exception when check_violation then null;
  end;

  delete from public.match_results where id = v_match;
  if exists (select 1 from public.match_shares where match_result_id = v_match) then
    raise exception 'Deleting a Match left its share links';
  end if;
end;
$$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.create_match_share(uuid,uuid,text,jsonb)',
    'public.read_active_match_share(uuid,uuid)',
    'public.revoke_match_share(uuid,uuid)',
    'public.read_public_share(text)'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
      or has_function_privilege('authenticated', v_function, 'EXECUTE')
      or not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Share RPC privilege mismatch: %', v_function;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.match_shares', 'SELECT')
    or has_table_privilege('authenticated', 'public.match_shares', 'SELECT') then
    raise exception 'Clients can read share rows directly';
  end if;
end;
$$;
