-- Safe manual rollback for Issue #15. Keep client grants revoked while
-- policies are absent, so rolling back cannot expose personal rows.
drop policy if exists profiles_owner_read on public.profiles;
drop policy if exists career_profile_versions_owner_read on public.career_profile_versions;
drop policy if exists career_profile_target_roles_owner_read on public.career_profile_target_roles;
drop policy if exists career_profile_axis_values_owner_read on public.career_profile_axis_values;
drop policy if exists career_constraints_owner_read on public.career_constraints;
drop policy if exists career_constraint_locations_owner_read on public.career_constraint_locations;
drop policy if exists user_saved_jobs_owner_read on public.user_saved_jobs;
drop policy if exists match_results_owner_read on public.match_results;
drop policy if exists match_axis_results_owner_read on public.match_axis_results;
drop policy if exists match_constraint_results_owner_read on public.match_constraint_results;

revoke all on all tables in schema public from anon, authenticated;
-- Deliberately retain deny-by-default privileges for future tables.
