-- Manual rollback for the v1.0 legal documents. Documents are immutable once
-- users rely on them (ADR-022): this only works while nobody has recorded an
-- acknowledgement, because user_legal_acknowledgements references them with
-- ON DELETE RESTRICT. After release, publish a corrected new version instead.
begin;

delete from public.legal_documents
where (document_type, version) in (('terms', '1.0'), ('privacy_policy', '1.0'));

commit;
