-- ADR-045: the Job Resolver's first candidate source is postings this
-- service has already analyzed. Read-only; the matching is deliberately
-- broad (substring either way) and the domain narrows it further.
begin;

create function public.search_known_job_postings(
  p_company text,
  p_limit integer
)
returns table (
  company_name text,
  title text,
  url text,
  employment_types jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_company text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_company, '')));
begin
  if pg_catalog.length(v_company) < 1 or pg_catalog.length(v_company) > 100
    or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid_job_search' using errcode = '22023';
  end if;
  return query
    select c.name, j.title, s.normalized_url,
      coalesce((
        select f.payload -> 'value'
        from public.evaluation_targets t
        join public.evaluations e on e.target_id = t.id
        join public.evaluation_job_facts f
          on f.evaluation_id = e.id and f.kind = 'employmentType'
        where t.job_posting_id = j.id and f.payload ->> 'status' = 'known'
        order by e.created_at desc
        limit 1
      ), '[]'::jsonb)
    from public.job_postings j
    join public.companies c on c.id = j.company_id
    join public.source_urls s on s.id = j.source_url_id
    where pg_catalog.strpos(pg_catalog.lower(c.name), v_company) > 0
      or pg_catalog.strpos(v_company, pg_catalog.lower(c.name)) > 0
    order by j.created_at desc, j.id
    limit p_limit;
end;
$$;

revoke all on function public.search_known_job_postings(text, integer)
  from public, anon, authenticated;
grant execute on function public.search_known_job_postings(text, integer)
  to service_role;

commit;
