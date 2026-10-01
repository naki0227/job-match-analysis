-- ADR-045: known postings are searchable by company name, as service_role only.
begin;
do $$
declare
  v_company uuid;
  v_other uuid;
  v_source uuid;
begin
  insert into public.companies(name) values ('株式会社リゾルバー')
    returning id into v_company;
  insert into public.companies(name) values ('別会社') returning id into v_other;
  insert into public.source_urls(raw_url, normalized_url)
    values ('https://ats.example/jobs/1?utm_source=x', 'https://ats.example/jobs/1')
    returning id into v_source;
  insert into public.job_postings(company_id, source_url_id, title)
    values (v_company, v_source, '法人営業');
  insert into public.source_urls(raw_url, normalized_url)
    values ('https://ats.example/jobs/2', 'https://ats.example/jobs/2')
    returning id into v_source;
  insert into public.job_postings(company_id, source_url_id, title)
    values (v_other, v_source, '法人営業');
  insert into public.job_postings(company_id, title) values (v_company, 'URLなし');
end;
$$;

set local role service_role;
do $$
declare
  v_row record;
  v_count integer;
begin
  select count(*) into v_count from public.search_known_job_postings('リゾルバー', 10);
  select * into v_row from public.search_known_job_postings('リゾルバー', 10);
  if v_count <> 1 or v_row.url <> 'https://ats.example/jobs/1'
    or v_row.company_name <> '株式会社リゾルバー'
    or v_row.employment_types <> '[]'::jsonb then
    raise exception 'known posting search returned %', v_row;
  end if;
  -- A query longer than the stored name still matches it.
  select count(*) into v_count
    from public.search_known_job_postings('株式会社リゾルバー 東京', 10);
  if v_count <> 1 then
    raise exception 'a query containing the company name did not match';
  end if;
  select count(*) into v_count
    from public.search_known_job_postings('存在しない会社', 10);
  if v_count <> 0 then
    raise exception 'an unrelated company matched';
  end if;
  begin
    perform public.search_known_job_postings(' ', 10);
    raise exception 'blank company was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.search_known_job_postings('x', 51);
    raise exception 'oversized limit was accepted';
  exception when sqlstate '22023' then null;
  end;
end;
$$;
reset role;
rollback;

do $$
begin
  if has_function_privilege('authenticated',
      'public.search_known_job_postings(text,integer)', 'execute')
    or has_function_privilege('anon',
      'public.search_known_job_postings(text,integer)', 'execute') then
    raise exception 'clients can search known postings directly';
  end if;
end;
$$;
