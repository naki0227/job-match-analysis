-- Run immediately after Issue #38 down migration.
do $$
begin
  if to_regclass('public.profile_educations') is not null
    or to_regclass('public.legal_documents') is not null
    or to_regclass('public.user_legal_acknowledgements') is not null
    or exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
        and column_name in ('display_name', 'full_name', 'contact_email', 'contact_phone')
    ) then
    raise exception 'Issue #38 rollback left schema objects';
  end if;
end;
$$;
