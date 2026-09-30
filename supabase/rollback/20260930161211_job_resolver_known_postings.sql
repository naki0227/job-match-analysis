-- Manual rollback for the Job Resolver's known-postings search.
begin;

drop function public.search_known_job_postings(text, integer);

commit;
