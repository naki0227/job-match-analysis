do $$
begin
  if to_regclass('public.analytics_consent_events') is not null
    or to_regclass('public.analytics_consent_policies') is not null
    or exists (select 1 from pg_namespace where nspname in ('analytics', 'analytics_private'))
    or exists (select 1 from pg_roles where rolname = 'analytics_reader') then
    raise exception 'Analytics consent rollback left objects behind';
  end if;
end;
$$;
