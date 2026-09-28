drop function public.commit_career_profile(uuid, integer, uuid, jsonb);
alter table public.career_profile_versions
  drop constraint career_profile_versions_user_idempotency_unique;
alter table public.career_profile_versions drop column idempotency_key;
