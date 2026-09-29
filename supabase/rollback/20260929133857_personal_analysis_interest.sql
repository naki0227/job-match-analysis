begin;
drop function if exists public.list_unmatched_analysis_evaluations(uuid, integer);
drop function if exists public.request_personal_analysis(uuid, text, text, text, timestamptz);
drop table if exists public.user_analysis_requests;
commit;
