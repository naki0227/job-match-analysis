do $$
begin
  if to_regclass('public.match_shares') is not null
    or to_regprocedure('public.create_match_share(uuid,uuid,text,jsonb)') is not null
    or to_regprocedure('public.read_public_share(text)') is not null
    or to_regclass('public.match_results') is null then
    raise exception 'Issue #39 rollback left share objects or removed Matches';
  end if;
end;
$$;
