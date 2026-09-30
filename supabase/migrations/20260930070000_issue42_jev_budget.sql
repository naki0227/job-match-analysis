-- Issue #42: service-wide daily budget for Jev evidence candidates.
-- Workers reserve units before calling Jev; the limit is a worker setting.
begin;

create table public.jev_daily_usage (
  usage_date date primary key,
  reserved_units integer not null default 0 check (reserved_units >= 0),
  updated_at timestamptz not null default now()
);

alter table public.jev_daily_usage enable row level security;
revoke all on public.jev_daily_usage from public, anon, authenticated;
grant select, insert, update on public.jev_daily_usage to service_role;

-- All-or-nothing: returns true and records p_units only if today's total
-- stays within p_daily_limit. Concurrent workers serialize on the day row.
create function public.reserve_jev_budget(p_units integer, p_daily_limit integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day date := (pg_catalog.now() at time zone 'UTC')::date;
  v_reserved integer;
begin
  if p_units is null or p_units < 1 or p_daily_limit is null
    or p_daily_limit < 1 then
    raise exception 'invalid_jev_budget_request' using errcode = '22023';
  end if;
  insert into public.jev_daily_usage (usage_date) values (v_day)
  on conflict (usage_date) do nothing;
  update public.jev_daily_usage
  set reserved_units = reserved_units + p_units, updated_at = pg_catalog.now()
  where usage_date = v_day and reserved_units + p_units <= p_daily_limit
  returning reserved_units into v_reserved;
  return v_reserved is not null;
end;
$$;

revoke all on function public.reserve_jev_budget(integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_jev_budget(integer, integer)
  to service_role;

commit;
