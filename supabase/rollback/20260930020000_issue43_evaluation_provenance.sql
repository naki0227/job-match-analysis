begin;
drop function public.commit_analysis_evaluation_v2(uuid, uuid, uuid, jsonb, jsonb);
drop table public.evaluation_job_facts;
alter table public.evaluated_axis_values drop column evaluation_method;
commit;
