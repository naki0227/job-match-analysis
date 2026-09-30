-- Manual rollback for the service_role core privileges. Only run after the
-- API and crawler are stopped: without these grants they fail with 42501.
begin;

revoke select, insert, update on public.profiles from service_role;
revoke select, insert on public.career_profile_versions from service_role;
revoke select, insert on public.career_profile_target_roles from service_role;
revoke select, insert on public.career_profile_axis_values from service_role;
revoke select, insert on public.career_constraints from service_role;
revoke select, insert on public.career_constraint_locations from service_role;
revoke select on public.assessment_axes from service_role;
revoke select, insert, update on public.source_urls from service_role;
revoke select, insert, update on public.source_document_versions from service_role;
revoke select, insert, update on public.analysis_jobs from service_role;
revoke select, insert on public.companies from service_role;
revoke select, insert on public.job_postings from service_role;
revoke select, insert, update on public.evaluation_targets from service_role;
revoke select, insert on public.evaluations from service_role;
revoke select, insert on public.evaluation_sources from service_role;
revoke select, insert, update on public.evaluated_axis_values from service_role;
revoke select, insert on public.evaluation_evidence from service_role;
revoke select, insert, update on public.match_results from service_role;
revoke select, insert on public.match_axis_results from service_role;
revoke select, insert on public.match_constraint_results from service_role;

commit;
