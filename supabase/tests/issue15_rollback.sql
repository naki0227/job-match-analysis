-- A rollback must not restore client access to unprotected rows.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public') then
    raise exception 'Issue #15 rollback left policies behind';
  end if;
  if has_table_privilege('anon', 'public.profiles', 'SELECT')
    or has_table_privilege('authenticated', 'public.profiles', 'SELECT')
    or has_table_privilege('authenticated', 'public.companies', 'SELECT') then
    raise exception 'Issue #15 rollback reopened client access';
  end if;
end;
$$;
