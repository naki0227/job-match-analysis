-- Manual rollback for Issue #42 abuse signals. Events are 7-day data only.
begin;

drop function public.abuse_signal_overview(timestamptz);
drop function public.record_abuse_signal(uuid, text, bytea, bytea);
drop table public.abuse_signal_events;

commit;
