-- Manual rollback for the Issue #42 Jev budget. Usage history is removed.
begin;

drop function public.reserve_jev_budget(integer, integer);
drop table public.jev_daily_usage;

commit;
