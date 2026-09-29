drop trigger analysis_job_live_lease_completion on public.analysis_jobs;
drop function public.require_live_lease_for_completion();
drop function public.fail_analysis_job(uuid, uuid);
drop function public.renew_analysis_job_lease(uuid, uuid, integer);
drop function public.claim_analysis_job(uuid, integer, integer);
drop function public.reap_analysis_jobs(integer, integer);
