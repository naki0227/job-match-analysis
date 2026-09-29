-- Issue #27: filters are applied before keyset paging, with one DB call.
do $$
declare
  v_user uuid := '45000000-0000-4000-8000-000000000001';
  v_other uuid := '45000000-0000-4000-8000-000000000002';
  v_latest uuid;
  v_different uuid;
  v_cursor_sort integer;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
begin
  insert into public.career_profile_target_roles(profile_version_id, role_order, role_text)
  values
    ('45000000-0000-4000-8000-000000000004', 0, 'Backend Engineer'),
    ('45000000-0000-4000-8000-000000000005', 0, 'Platform Engineer'),
    ('45000000-0000-4000-8000-000000000006', 0, 'Designer');
  select m.id into v_latest from public.match_results m
    where m.user_id = v_user
      and m.career_profile_version_id = '45000000-0000-4000-8000-000000000005';
  select m.id into v_different from public.match_results m
    where m.user_id = v_user and m.id <> v_latest
      and m.evaluation_id in (
        select e.id from public.evaluations e
        where e.source_set_hash = 'job-45-120'
      );
  insert into public.match_axis_results
    (match_result_id, axis_key, axis_version, preference, importance,
     observation_status, observed_anchor, comparison_status, difference)
  values
    (v_latest, 'autonomy', 1, 50, 50, 'known', 50, 'close', 0),
    (v_latest, 'collaboration', 1, 50, 50, 'unknown', null, 'unknown', null),
    (v_different, 'autonomy', 1, 0, 50, 'known', 100, 'different', 100);
  insert into public.match_constraint_results(match_result_id, kind, status, reason)
    values (v_latest, 'min_salary', 'unknown', 'stale_information');

  if (select count(*) from public.list_analysis_history_page_v2(
      v_user, 20, '2026-08-01T00:00:00Z')) <> 21
    or (select count(*) from public.list_analysis_history_page_v2(
      v_user, 100, '2026-08-01T00:00:00Z')) <> 101
    or (select count(*) from public.list_analysis_history_page_v2(
      v_other, 20, '2026-08-01T00:00:00Z')) <> 1 then
    raise exception 'History v2 page size or owner isolation failed';
  end if;
  if (select count(*) from public.list_analysis_history_page_v2(
      v_user, 20, '2026-08-01T00:00:00Z', p_role => 'Platform Engineer')) <> 1
    or (select count(*) from public.list_analysis_history_page_v2(
      v_user, 20, '2026-08-01T00:00:00Z', p_role => 'Designer')) <> 0
    or (select count(*) from public.list_analysis_history_page_v2(
      v_user, 20, '2026-08-01T00:00:00Z', p_judgement => 'has_unknown')) <> 1
    or (select count(*) from public.list_analysis_history_page_v2(
      v_user, 20, '2026-08-01T00:00:00Z', p_judgement => 'has_different')) <> 1 then
    raise exception 'History v2 role or judgement filter failed';
  end if;
  if (select not stale_conditions or close_count <> 1 or unknown_count <> 1
      or target_roles <> array['Platform Engineer']::text[]
      from public.list_analysis_history_page_v2(
        v_user, 100, '2026-08-01T00:00:00Z')
      where match_result_id = v_latest) then
    raise exception 'History v2 versioned role, summary, or stale flag failed';
  end if;
  if (select match_result_id from public.list_analysis_history_page_v2(
      v_user, 20, '2026-08-01T00:00:00Z', p_sort => 'close') limit 1)
      is distinct from v_latest then
    raise exception 'History v2 close sorting failed';
  end if;
  select sort_count, analyzed_at, match_result_id
    into v_cursor_sort, v_cursor_at, v_cursor_id
    from public.list_analysis_history_page_v2(
      v_user, 20, '2026-08-01T00:00:00Z', p_sort => 'fewest_unknown')
    offset 19 limit 1;
  if (select count(*) from public.list_analysis_history_page_v2(
      v_user, 20, '2026-08-01T00:00:00Z',
      p_sort => 'fewest_unknown', p_cursor_sort_count => v_cursor_sort,
      p_cursor_analyzed_at => v_cursor_at,
      p_cursor_match_result_id => v_cursor_id)) <> 21
    or exists (
      select 1 from public.list_analysis_history_page_v2(
        v_user, 20, '2026-08-01T00:00:00Z',
        p_sort => 'fewest_unknown', p_cursor_sort_count => v_cursor_sort,
        p_cursor_analyzed_at => v_cursor_at,
        p_cursor_match_result_id => v_cursor_id)
      where (sort_count, analyzed_at, match_result_id)
        >= (v_cursor_sort, v_cursor_at, v_cursor_id)
    ) then
    raise exception 'History v2 sorted cursor overlapped or skipped rows';
  end if;
  begin
    perform public.list_analysis_history_page_v2(
      v_user, 20, '2026-08-01T00:00:00Z', p_cursor_sort_count => 0);
    raise exception 'partial cursor accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

do $$
begin
  if has_function_privilege('anon',
      'public.list_analysis_history_page_v2(uuid,integer,timestamptz,text,text,text,integer,timestamptz,uuid)',
      'EXECUTE')
    or has_function_privilege('authenticated',
      'public.list_analysis_history_page_v2(uuid,integer,timestamptz,text,text,text,integer,timestamptz,uuid)',
      'EXECUTE')
    or not has_function_privilege('service_role',
      'public.list_analysis_history_page_v2(uuid,integer,timestamptz,text,text,text,integer,timestamptz,uuid)',
      'EXECUTE') then
    raise exception 'History v2 privilege mismatch';
  end if;
end;
$$;
