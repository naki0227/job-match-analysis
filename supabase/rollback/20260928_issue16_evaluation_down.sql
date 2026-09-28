drop function public.commit_analysis_evaluation(uuid, uuid, uuid, jsonb, jsonb);
alter table public.analysis_jobs drop constraint analysis_jobs_completed_evaluation_check;
