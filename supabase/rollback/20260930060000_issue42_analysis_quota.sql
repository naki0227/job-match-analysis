-- Manual rollback for Issue #42 quota. Quota history is removed; requests stay.
begin;

drop function public.request_personal_analysis_limited(
  uuid, text, text, text, timestamptz, timestamptz, integer
);
drop table public.user_analysis_quota_events;

commit;
