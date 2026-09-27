-- Manual rollback for both Issue #14 up migrations, in reverse dependency order.
-- Run only after backing up data; this deletes all rows in these tables.
begin;

drop table public.match_constraint_results;
drop table public.match_axis_results;
drop table public.match_results;
drop table public.user_saved_jobs;
drop table public.analysis_jobs;
drop table public.evaluation_evidence;
drop table public.evaluated_axis_values;
drop table public.evaluation_sources;
drop table public.evaluations;
drop table public.evaluation_targets;
drop table public.source_document_versions;
drop table public.job_postings;
drop table public.source_urls;
drop table public.companies;
drop table public.career_constraint_locations;
drop table public.career_constraints;
drop table public.career_profile_axis_values;
drop table public.career_profile_versions;
drop table public.assessment_axes;
drop table public.profiles;

commit;
