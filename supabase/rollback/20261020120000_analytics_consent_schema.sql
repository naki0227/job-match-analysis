-- Manual rollback for ADR-043. Consent history is dropped with its tables;
-- export it first if it must be kept.
begin;

drop schema analytics cascade;
drop schema analytics_private cascade;
drop owned by analytics_reader;
drop role analytics_reader;
drop function public.record_analytics_consent(uuid, uuid, text);
drop function public.analytics_consent_status(uuid);
drop function public.analytics_consent_policies_current_at(timestamptz);
drop table public.analytics_consent_events;
drop table public.analytics_consent_policies;

commit;
