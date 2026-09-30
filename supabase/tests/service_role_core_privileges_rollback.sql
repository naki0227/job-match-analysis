do $$
begin
  if has_table_privilege('service_role', 'public.source_document_versions', 'SELECT')
    or has_table_privilege('service_role', 'public.profiles', 'INSERT')
    or has_table_privilege('service_role', 'public.match_results', 'UPDATE')
    or not has_table_privilege('service_role', 'public.match_shares', 'SELECT') then
    raise exception 'service_role core privileges rollback is incomplete or too broad';
  end if;
end;
$$;
