-- Issue #38 rollback. Destructive: back up private profile and legal history first.
drop table public.user_legal_acknowledgements;
drop table public.legal_documents;
drop table public.profile_educations;

alter table public.profiles
  drop column contact_phone,
  drop column contact_email,
  drop column full_name,
  drop column display_name;
