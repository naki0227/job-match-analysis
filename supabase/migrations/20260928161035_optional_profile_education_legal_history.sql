-- Issue #38: optional private profile data and versioned legal acknowledgements.
-- All existing profiles remain valid because every new profile field is nullable.
alter table public.profiles
  add column display_name text check (
    display_name is null or
    (display_name = btrim(display_name) and length(display_name) between 1 and 120)
  ),
  add column full_name text check (
    full_name is null or
    (full_name = btrim(full_name) and length(full_name) between 1 and 200)
  ),
  add column contact_email text check (
    contact_email is null or
    (contact_email = btrim(contact_email) and length(contact_email) between 1 and 320)
  ),
  add column contact_phone text check (
    contact_phone is null or
    (contact_phone = btrim(contact_phone) and length(contact_phone) between 1 and 50)
  );

create table public.profile_educations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  institution_name text not null check (
    institution_name = btrim(institution_name)
    and length(institution_name) between 1 and 200
  ),
  faculty text check (
    faculty is null or (faculty = btrim(faculty) and length(faculty) between 1 and 200)
  ),
  department text check (
    department is null or (department = btrim(department) and length(department) between 1 and 200)
  ),
  degree text check (
    degree is null or (degree = btrim(degree) and length(degree) between 1 and 120)
  ),
  started_on date,
  ended_on date,
  verification_status text not null default 'self_reported'
    check (verification_status in ('self_reported', 'verified')),
  created_at timestamptz not null default now(),
  check (started_on is null or ended_on is null or ended_on >= started_on)
);

create index profile_educations_user_created_idx
  on public.profile_educations (user_id, created_at desc);

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('terms', 'privacy_policy')),
  version text not null check (version = btrim(version) and length(version) between 1 and 80),
  body_markdown text not null check (length(btrim(body_markdown)) > 0),
  published_at timestamptz not null,
  effective_at timestamptz not null,
  unique (document_type, version),
  check (effective_at >= published_at)
);

create index legal_documents_type_effective_idx
  on public.legal_documents (document_type, effective_at desc);

create table public.user_legal_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  legal_document_id uuid not null references public.legal_documents(id) on delete restrict,
  action text not null check (action in ('accepted', 'acknowledged')),
  recorded_at timestamptz not null default now(),
  unique (user_id, legal_document_id, action)
);

create index user_legal_acknowledgements_user_recorded_idx
  on public.user_legal_acknowledgements (user_id, recorded_at desc);
create index user_legal_acknowledgements_document_idx
  on public.user_legal_acknowledgements (legal_document_id);

alter table public.profile_educations enable row level security;
alter table public.legal_documents enable row level security;
alter table public.user_legal_acknowledgements enable row level security;

-- Client writes remain forbidden; server-side APIs validate and write.
revoke all on public.profile_educations,
  public.legal_documents,
  public.user_legal_acknowledgements
from anon, authenticated;
revoke all on public.legal_documents,
  public.user_legal_acknowledgements
from service_role;
grant select on public.profile_educations,
  public.user_legal_acknowledgements
to authenticated;
grant select on public.legal_documents to anon, authenticated;
grant select, insert, update, delete on public.profile_educations to service_role;
grant select, insert on public.legal_documents,
  public.user_legal_acknowledgements
to service_role;

create policy profile_educations_owner_read on public.profile_educations
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy legal_documents_published_read on public.legal_documents
  for select to anon, authenticated
  using (published_at <= now());

create policy user_legal_acknowledgements_owner_read
  on public.user_legal_acknowledgements
  for select to authenticated
  using ((select auth.uid()) = user_id);
