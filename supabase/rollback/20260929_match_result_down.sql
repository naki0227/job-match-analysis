-- Manual rollback for the Match API RPCs. Stored Match rows are kept because
-- the tables belong to Issue #14; only the functions are removed.
begin;

drop function public.read_match_result(uuid, uuid);
drop function public.commit_match_result(uuid, uuid, uuid, text, jsonb, jsonb);
drop function public.read_evaluation_for_match(uuid);
drop function public.evaluation_match_snapshot(uuid);

commit;
