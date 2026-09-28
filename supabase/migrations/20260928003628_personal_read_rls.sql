-- Issue #15: client roles may read only their own personal records.
-- Shared records and all writes stay behind the authenticated Hono API.
revoke all on all tables in schema public from anon, authenticated;

-- New tables must opt in to client access explicitly in later migrations.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

grant select on public.profiles,
  public.career_profile_versions,
  public.career_profile_target_roles,
  public.career_profile_axis_values,
  public.career_constraints,
  public.career_constraint_locations,
  public.user_saved_jobs,
  public.match_results,
  public.match_axis_results,
  public.match_constraint_results
to authenticated;

create policy profiles_owner_read on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy career_profile_versions_owner_read on public.career_profile_versions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy career_profile_target_roles_owner_read on public.career_profile_target_roles
  for select to authenticated
  using (exists (
    select 1 from public.career_profile_versions v
    where v.id = profile_version_id and v.user_id = (select auth.uid())
  ));

create policy career_profile_axis_values_owner_read on public.career_profile_axis_values
  for select to authenticated
  using (exists (
    select 1 from public.career_profile_versions v
    where v.id = profile_version_id and v.user_id = (select auth.uid())
  ));

create policy career_constraints_owner_read on public.career_constraints
  for select to authenticated
  using (exists (
    select 1 from public.career_profile_versions v
    where v.id = profile_version_id and v.user_id = (select auth.uid())
  ));

create policy career_constraint_locations_owner_read on public.career_constraint_locations
  for select to authenticated
  using (exists (
    select 1 from public.career_profile_versions v
    where v.id = profile_version_id and v.user_id = (select auth.uid())
  ));

create policy user_saved_jobs_owner_read on public.user_saved_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy match_results_owner_read on public.match_results
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy match_axis_results_owner_read on public.match_axis_results
  for select to authenticated
  using (exists (
    select 1 from public.match_results m
    where m.id = match_result_id and m.user_id = (select auth.uid())
  ));

create policy match_constraint_results_owner_read on public.match_constraint_results
  for select to authenticated
  using (exists (
    select 1 from public.match_results m
    where m.id = match_result_id and m.user_id = (select auth.uid())
  ));
