-- Manual rollback for the legal consent RPCs. Recorded acknowledgements stay.
begin;

drop function public.list_legal_acknowledgements(uuid);
drop function public.record_legal_acknowledgements(uuid, uuid, uuid);
drop function public.legal_acknowledgement_status(uuid);
drop function public.current_legal_documents();
drop function public.legal_documents_current_at(timestamptz);

commit;
