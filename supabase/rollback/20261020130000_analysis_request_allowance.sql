-- Manual rollback for the analysis request allowance and audit summary.
-- Signals of the added types are deleted so the original check can return.
begin;

drop function public.abuse_user_signal_summary(timestamptz, integer);
delete from public.abuse_signal_events
where event_type in ('analysis_cached', 'analysis_rate_limited');
alter table public.abuse_signal_events
  drop constraint abuse_signal_events_event_type_check;
alter table public.abuse_signal_events
  add constraint abuse_signal_events_event_type_check check (event_type in (
    'analysis_new', 'analysis_quota_rejected',
    'career_profile_saved', 'share_created'
  ));
drop function public.consume_analysis_request_allowance(uuid, timestamptz, integer);
drop table public.user_analysis_request_events;

commit;
