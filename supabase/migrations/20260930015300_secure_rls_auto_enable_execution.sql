-- Harden Supabase's optional automatic-RLS event trigger helper.
-- Hosted projects created with "Automatically enable RLS" may provide
-- public.rls_auto_enable(). It is SECURITY DEFINER and does not need to be
-- directly executable through the Data API roles.
--
-- Keep this migration portable: local/dev environments may not have the
-- hosted helper function at all.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;
