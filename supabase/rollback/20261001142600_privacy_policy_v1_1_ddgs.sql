begin;
delete from public.legal_documents
where document_type = 'privacy_policy' and version = '1.1';
commit;
