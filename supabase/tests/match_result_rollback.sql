do $$
begin
  if to_regprocedure('public.commit_match_result(uuid,uuid,uuid,text,jsonb,jsonb)') is not null
    or to_regprocedure('public.read_match_result(uuid,uuid)') is not null
    or to_regprocedure('public.read_evaluation_for_match(uuid)') is not null
    or to_regprocedure('public.evaluation_match_snapshot(uuid)') is not null
    or to_regclass('public.match_results') is null then
    raise exception 'Match RPC rollback left functions or removed tables';
  end if;
end;
$$;
