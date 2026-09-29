begin;

drop function public.list_analysis_history_page_v2(
  uuid, integer, timestamptz, text, text, text, integer, timestamptz, uuid
);

commit;
