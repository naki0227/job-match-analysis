-- Manual rollback for Issue #45. The old bookmark table returns empty because
-- the forward migration refuses to drop it when it has any rows.
begin;

drop function public.list_analysis_history_page(uuid, integer, timestamptz, uuid);
drop index public.match_results_history_page_idx;
create index match_results_user_created_idx
  on public.match_results (user_id, created_at desc);

create table public.user_saved_jobs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_posting_id uuid not null references public.job_postings(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, job_posting_id)
);
create index user_saved_jobs_job_idx on public.user_saved_jobs (job_posting_id);
create index user_saved_jobs_page_idx
  on public.user_saved_jobs (user_id, created_at desc, job_posting_id desc);
alter table public.user_saved_jobs enable row level security;
revoke all on public.user_saved_jobs from public, anon, authenticated, service_role;
grant select on public.user_saved_jobs to authenticated;
grant select, insert, update, delete on public.user_saved_jobs to service_role;
create policy user_saved_jobs_owner_read on public.user_saved_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.list_saved_jobs_page(
  p_user_id uuid,
  p_limit integer,
  p_cursor_created_at timestamptz default null,
  p_cursor_job_posting_id uuid default null
)
returns table (
  job_posting_id uuid,
  saved_at timestamptz,
  job_title text,
  company_id uuid,
  company_name text,
  job_evaluation_id uuid,
  job_evaluated_at timestamptz,
  company_evaluation_id uuid,
  company_evaluated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user_id is null or p_limit is null or p_limit < 1 or p_limit > 100
    or (p_cursor_created_at is null) <> (p_cursor_job_posting_id is null) then
    raise exception 'invalid_saved_jobs_page_request' using errcode = '22023';
  end if;

  return query
  with page as materialized (
    select s.job_posting_id, s.created_at
    from public.user_saved_jobs s
    where s.user_id = p_user_id
      and (
        p_cursor_created_at is null
        or (s.created_at, s.job_posting_id)
          < (p_cursor_created_at, p_cursor_job_posting_id)
      )
    order by s.created_at desc, s.job_posting_id desc
    limit p_limit + 1
  )
  select
    j.id, page.created_at, j.title, c.id, c.name,
    je.id, je.created_at, ce.id, ce.created_at
  from page
  join public.job_postings j on j.id = page.job_posting_id
  join public.companies c on c.id = j.company_id
  left join lateral (
    select e.id, e.created_at
    from public.evaluation_targets t
    join public.evaluations e on e.target_id = t.id
    where t.target_type = 'job' and t.job_posting_id = j.id
    order by e.created_at desc, e.id desc
    limit 1
  ) je on true
  left join lateral (
    select e.id, e.created_at
    from public.evaluation_targets t
    join public.evaluations e on e.target_id = t.id
    where t.target_type = 'company' and t.company_id = c.id
    order by e.created_at desc, e.id desc
    limit 1
  ) ce on true
  order by page.created_at desc, page.job_posting_id desc;
end;
$$;

revoke all on function public.list_saved_jobs_page(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_saved_jobs_page(uuid, integer, timestamptz, uuid)
  to service_role;

commit;
