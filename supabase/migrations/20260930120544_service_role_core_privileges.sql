-- Server-side table privileges for the tables created before explicit grants
-- became the rule. Local tests used to grant everything to service_role in a
-- fixture, but hosted Supabase does not: BYPASSRLS skips policies, not table
-- privileges, so the crawler got 42501 on source_document_versions.
--
-- Each grant is the minimum that the API/crawler PostgREST calls and the
-- SECURITY INVOKER RPCs they call need (audited 2026-09-30). SELECT ... FOR
-- UPDATE needs UPDATE, so locked tables have it. No DELETE: personal rows go
-- away through auth.users ON DELETE CASCADE, and shared data is never
-- deleted by the application. anon/authenticated privileges and RLS policies
-- are unchanged.
begin;

-- Account and CareerProfile (API: profile bootstrap upsert, profile reads;
-- commit_career_profile and request_personal_analysis_limited lock profiles).
grant select, insert, update on public.profiles to service_role;
grant select, insert on public.career_profile_versions to service_role;
grant select, insert on public.career_profile_target_roles to service_role;
grant select, insert on public.career_profile_axis_values to service_role;
grant select, insert on public.career_constraints to service_role;
grant select, insert on public.career_constraint_locations to service_role;
grant select on public.assessment_axes to service_role;

-- Shared analysis jobs and sources (request_analysis, lease RPCs, crawler
-- source reads and 30-day text retention).
grant select, insert, update on public.source_urls to service_role;
grant select, insert, update on public.source_document_versions to service_role;
grant select, insert, update on public.analysis_jobs to service_role;

-- Shared evaluation (resolve_job_evaluation_target, commit_analysis_evaluation
-- and _v2, evaluation reads for Match and history).
grant select, insert on public.companies to service_role;
grant select, insert on public.job_postings to service_role;
grant select, insert, update on public.evaluation_targets to service_role;
grant select, insert on public.evaluations to service_role;
grant select, insert on public.evaluation_sources to service_role;
grant select, insert, update on public.evaluated_axis_values to service_role;
grant select, insert on public.evaluation_evidence to service_role;

-- Match results (commit_match_result, reads, history; create_match_share
-- locks the Match row).
grant select, insert, update on public.match_results to service_role;
grant select, insert on public.match_axis_results to service_role;
grant select, insert on public.match_constraint_results to service_role;

commit;
