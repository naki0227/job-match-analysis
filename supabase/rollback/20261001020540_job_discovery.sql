-- Manual rollback for web discovery. Verified postings stay in job_postings.
begin;

drop function public.read_job_discovery_query(uuid);
drop function public.read_job_discovery(uuid);
drop function public.fail_job_discovery(uuid, uuid, text, integer);
drop function public.complete_job_discovery(uuid, uuid, jsonb);
drop function public.claim_job_discovery(uuid, integer, integer);
drop function public.request_job_discovery(uuid, text, text, text, text,
  timestamptz, timestamptz, integer, integer, timestamptz);
drop function public.record_job_resolver_search(uuid, timestamptz, integer);
drop table public.job_resolver_events;
drop table public.job_discovery_results;
drop table public.job_discovery_requests;

commit;
