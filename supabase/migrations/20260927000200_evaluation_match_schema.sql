-- Issue #14: shared evaluation lineage, analysis jobs, and personal results.

create table public.evaluation_targets (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('company', 'job')),
  company_id uuid not null references public.companies(id) on delete restrict,
  job_posting_id uuid,
  created_at timestamptz not null default now(),
  foreign key (job_posting_id, company_id)
    references public.job_postings(id, company_id) on delete restrict,
  check (
    (target_type = 'company' and job_posting_id is null)
    or (target_type = 'job' and job_posting_id is not null)
  )
);

create unique index evaluation_targets_company_unique
  on public.evaluation_targets (company_id) where target_type = 'company';
create unique index evaluation_targets_job_unique
  on public.evaluation_targets (job_posting_id) where target_type = 'job';

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.evaluation_targets(id) on delete restrict,
  axis_catalog_version integer not null check (axis_catalog_version > 0),
  source_set_hash text not null check (length(source_set_hash) > 0),
  rubric_version text not null check (length(rubric_version) > 0),
  evaluator_version text not null check (length(evaluator_version) > 0),
  model_version text not null check (length(model_version) > 0),
  created_at timestamptz not null default now(),
  unique (target_id, source_set_hash, rubric_version, evaluator_version, model_version),
  unique (id, axis_catalog_version)
);

create index evaluations_target_created_idx
  on public.evaluations (target_id, created_at desc);

create table public.evaluation_sources (
  evaluation_id uuid not null references public.evaluations(id) on delete restrict,
  source_document_version_id uuid not null
    references public.source_document_versions(id) on delete restrict,
  primary key (evaluation_id, source_document_version_id)
);

create index evaluation_sources_document_idx
  on public.evaluation_sources (source_document_version_id);

create table public.evaluated_axis_values (
  evaluation_id uuid not null,
  axis_key text not null,
  axis_version integer not null,
  observation_status text not null check (
    observation_status in ('known', 'unknown', 'conflicting', 'stale')
  ),
  anchor_value smallint,
  primary key (evaluation_id, axis_key),
  foreign key (evaluation_id, axis_version)
    references public.evaluations(id, axis_catalog_version) on delete restrict,
  foreign key (axis_key, axis_version)
    references public.assessment_axes(axis_key, axis_version) on delete restrict,
  check (
    (observation_status in ('known', 'stale')
      and anchor_value is not null and anchor_value in (0, 50, 100))
    or (observation_status in ('unknown', 'conflicting') and anchor_value is null)
  )
);

create table public.evaluation_evidence (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null,
  axis_key text not null,
  source_document_version_id uuid not null,
  excerpt text not null check (length(btrim(excerpt)) > 0),
  locator text,
  foreign key (evaluation_id, axis_key)
    references public.evaluated_axis_values(evaluation_id, axis_key) on delete restrict,
  foreign key (evaluation_id, source_document_version_id)
    references public.evaluation_sources(evaluation_id, source_document_version_id)
    on delete restrict
);

create index evaluation_evidence_axis_idx
  on public.evaluation_evidence (evaluation_id, axis_key);
create index evaluation_evidence_source_idx
  on public.evaluation_evidence (evaluation_id, source_document_version_id);

create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  source_url_id uuid not null references public.source_urls(id) on delete restrict,
  analyzer_version text not null check (length(analyzer_version) > 0),
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  worker_token uuid,
  evaluation_id uuid references public.evaluations(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index analysis_jobs_active_unique
  on public.analysis_jobs (source_url_id, analyzer_version)
  where status in ('queued', 'running');

create index analysis_jobs_claim_idx
  on public.analysis_jobs (status, lease_until, created_at)
  where status in ('queued', 'running');

create table public.user_saved_jobs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_posting_id uuid not null references public.job_postings(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, job_posting_id)
);

create index user_saved_jobs_job_idx on public.user_saved_jobs (job_posting_id);

create table public.match_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  career_profile_version_id uuid not null,
  evaluation_id uuid not null,
  axis_catalog_version integer not null,
  algorithm_version text not null check (length(algorithm_version) > 0),
  created_at timestamptz not null default now(),
  foreign key (career_profile_version_id, user_id)
    references public.career_profile_versions(id, user_id) on delete cascade,
  foreign key (career_profile_version_id, axis_catalog_version)
    references public.career_profile_versions(id, axis_catalog_version) on delete cascade,
  foreign key (evaluation_id, axis_catalog_version)
    references public.evaluations(id, axis_catalog_version) on delete restrict,
  unique (career_profile_version_id, evaluation_id, algorithm_version),
  unique (id, axis_catalog_version)
);

create index match_results_user_created_idx
  on public.match_results (user_id, created_at desc);
create index match_results_evaluation_idx
  on public.match_results (evaluation_id);

create table public.match_axis_results (
  match_result_id uuid not null,
  axis_key text not null,
  axis_version integer not null,
  preference smallint not null check (preference between 0 and 100),
  importance smallint not null check (importance between 0 and 100),
  observation_status text not null check (
    observation_status in ('known', 'unknown', 'conflicting', 'stale')
  ),
  observed_anchor smallint,
  comparison_status text not null check (
    comparison_status in ('close', 'different', 'excluded', 'unknown', 'conflicting', 'stale')
  ),
  difference smallint check (difference between 0 and 100),
  primary key (match_result_id, axis_key),
  foreign key (match_result_id, axis_version)
    references public.match_results(id, axis_catalog_version) on delete cascade,
  foreign key (axis_key, axis_version)
    references public.assessment_axes(axis_key, axis_version) on delete restrict,
  check (
    (observation_status in ('known', 'stale')
      and observed_anchor is not null and observed_anchor in (0, 50, 100))
    or (observation_status in ('unknown', 'conflicting') and observed_anchor is null)
  ),
  check (
    (comparison_status = 'close' and observation_status = 'known'
      and importance > 0 and difference is not null
      and difference = abs(preference - observed_anchor) and difference <= 25)
    or (comparison_status = 'different' and observation_status = 'known'
      and importance > 0 and difference is not null
      and difference = abs(preference - observed_anchor) and difference > 25)
    or (comparison_status = 'excluded' and importance = 0 and difference is null)
    or (comparison_status in ('unknown', 'conflicting', 'stale')
      and comparison_status = observation_status and importance > 0 and difference is null)
  )
);

create table public.match_constraint_results (
  match_result_id uuid not null references public.match_results(id) on delete cascade,
  kind text not null check (kind in ('min_salary', 'location', 'full_remote')),
  status text not null check (status in ('met', 'unmet', 'unknown', 'not_required')),
  reason text,
  primary key (match_result_id, kind),
  check (
    (status in ('met', 'not_required') and reason is null)
    or (status = 'unmet' and reason is not null and reason in (
      'salary_below_minimum', 'location_outside_allowed',
      'regular_office_attendance_required'
    ))
    or (status = 'unknown' and reason is not null and reason in (
      'missing_information', 'conflicting_information', 'stale_information',
      'salary_unit_mismatch', 'salary_range_overlaps_minimum'
    ))
  ),
  check (
    reason is null
    or (kind = 'min_salary' and reason in (
      'missing_information', 'conflicting_information', 'stale_information',
      'salary_unit_mismatch', 'salary_range_overlaps_minimum', 'salary_below_minimum'
    ))
    or (kind = 'location' and reason in (
      'missing_information', 'conflicting_information', 'stale_information',
      'location_outside_allowed'
    ))
    or (kind = 'full_remote' and reason in (
      'missing_information', 'conflicting_information', 'stale_information',
      'regular_office_attendance_required'
    ))
  )
);

alter table public.evaluation_targets enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_sources enable row level security;
alter table public.evaluated_axis_values enable row level security;
alter table public.evaluation_evidence enable row level security;
alter table public.analysis_jobs enable row level security;
alter table public.user_saved_jobs enable row level security;
alter table public.match_results enable row level security;
alter table public.match_axis_results enable row level security;
alter table public.match_constraint_results enable row level security;
