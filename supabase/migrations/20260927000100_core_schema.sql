-- Issue #14: reference, personal profile, and public source tables.
-- Supabase provides auth.users. Local integration tests create a minimal fixture.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.assessment_axes (
  id uuid primary key default gen_random_uuid(),
  axis_key text not null,
  axis_version integer not null check (axis_version > 0),
  question_ja text not null,
  user_anchor_0 text not null,
  user_anchor_50 text not null,
  user_anchor_100 text not null,
  public_anchor_0 text not null,
  public_anchor_50 text not null,
  public_anchor_100 text not null,
  unique (axis_key, axis_version),
  check (axis_key in (
    'work_location', 'autonomy', 'collaboration', 'growth_direction',
    'work_change', 'schedule_flexibility', 'role_breadth', 'customer_contact'
  ))
);

-- ADR-010/012: the first immutable catalog is the eight documented MVP axes.
insert into public.assessment_axes (
  axis_key, axis_version, question_ja,
  user_anchor_0, user_anchor_50, user_anchor_100,
  public_anchor_0, public_anchor_50, public_anchor_100
) values
  ('work_location', 1, 'どの程度、在宅で働きたいですか？',
   '原則出社', '出社と在宅を併用', 'フルリモート',
   '出社前提の明記', '出社と在宅を併用する条件の明記', 'フルリモート可の明記'),
  ('autonomy', 1, '仕事の進め方をどの程度自分で決めたいですか？',
   '手順が明確', '一部を自分で決める', '方針や進め方を自分で決める',
   '手順・承認経路の明記', '一部の裁量範囲の明記', '方針や進め方の決定権の明記'),
  ('collaboration', 1, '日々の仕事をどの程度チームで進めたいですか？',
   '個人中心', '個人作業と共同作業を併用', 'チーム中心',
   '個人担当の明記', '個人と共同の両方の明記', 'チームでの共同責任の明記'),
  ('growth_direction', 1, '今の専門性を深めることと、新しい領域に挑むことのどちらを重視しますか？',
   '今の専門性を深める', '両方', '新しい領域に挑む',
   '特定分野を深める職務の明記', '両方の明記', '新しい領域を担う職務の明記'),
  ('work_change', 1, '仕事の進め方や優先順位はどの程度変化してほしいですか？',
   '予測可能な仕事', '適度な変化', '変化が速い仕事',
   '定型・安定した職務の明記', '定型と変化の両方の明記', '頻繁に優先順位が変わる職務の明記'),
  ('schedule_flexibility', 1, '働く時間をどの程度自分で調整したいですか？',
   '固定時間', '一部を調整できる', '広く調整できる',
   '固定勤務時間の明記', '時差勤務や一部フレックスの明記', 'コアタイムなし等の広い時間裁量の明記'),
  ('role_breadth', 1, '一つの専門領域と幅広い業務のどちらを希望しますか？',
   '特定領域に集中', '複数領域を一部兼務', '幅広い領域を担当',
   '担当領域が限定された職務の明記', '一部兼務の明記', '複数領域を横断する職務の明記'),
  ('customer_contact', 1, '顧客や利用者とどの程度直接関わりたいですか？',
   '直接の接点は少ない', 'ときどき関わる', '日常的に関わる',
   '直接接点のない職務の明記', '定期的な接点の明記', '日常的な顧客対応・共同作業の明記');

create table public.career_profile_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  version integer not null check (version > 0),
  axis_catalog_version integer not null check (axis_catalog_version > 0),
  status text not null check (status in ('draft', 'completed')),
  created_at timestamptz not null default now(),
  unique (user_id, version),
  unique (id, user_id),
  unique (id, axis_catalog_version)
);

create index career_profile_versions_user_created_idx
  on public.career_profile_versions (user_id, created_at desc);

create table public.career_profile_target_roles (
  profile_version_id uuid not null
    references public.career_profile_versions(id) on delete cascade,
  role_order integer not null check (role_order >= 0),
  role_text text not null check (
    length(btrim(role_text)) > 0 and role_text = btrim(role_text)
  ),
  primary key (profile_version_id, role_order),
  unique (profile_version_id, role_text)
);

create table public.career_profile_axis_values (
  profile_version_id uuid not null,
  axis_key text not null,
  axis_version integer not null,
  preference smallint not null check (preference between 0 and 100),
  importance smallint not null check (importance between 0 and 100),
  primary key (profile_version_id, axis_key),
  foreign key (profile_version_id, axis_version)
    references public.career_profile_versions(id, axis_catalog_version) on delete cascade,
  foreign key (axis_key, axis_version)
    references public.assessment_axes(axis_key, axis_version) on delete restrict
);

create table public.career_constraints (
  profile_version_id uuid primary key
    references public.career_profile_versions(id) on delete cascade,
  min_salary_amount bigint,
  min_salary_currency text,
  min_salary_period text,
  full_remote_required boolean not null default false,
  check (
    num_nonnulls(min_salary_amount, min_salary_currency, min_salary_period) = 0
    or
    (num_nonnulls(min_salary_amount, min_salary_currency, min_salary_period) = 3
      and min_salary_amount > 0 and min_salary_currency = 'JPY'
      and min_salary_period = 'year')
  )
);

create table public.career_constraint_locations (
  profile_version_id uuid not null
    references public.career_constraints(profile_version_id) on delete cascade,
  prefecture_code text not null check (
    prefecture_code ~ '^(0[1-9]|[1-3][0-9]|4[0-7])$'
  ),
  primary key (profile_version_id, prefecture_code)
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  official_domain text,
  created_at timestamptz not null default now()
);

create table public.source_urls (
  id uuid primary key default gen_random_uuid(),
  raw_url text not null check (length(raw_url) > 0),
  normalized_url text not null unique check (length(normalized_url) > 0),
  created_at timestamptz not null default now()
);

create table public.job_postings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  source_url_id uuid references public.source_urls(id) on delete restrict,
  title text not null check (length(btrim(title)) > 0),
  external_job_id text,
  created_at timestamptz not null default now(),
  unique (id, company_id)
);

create index job_postings_company_idx on public.job_postings (company_id);
create index job_postings_source_url_idx on public.job_postings (source_url_id)
  where source_url_id is not null;

create table public.source_document_versions (
  id uuid primary key default gen_random_uuid(),
  source_url_id uuid not null references public.source_urls(id) on delete restrict,
  content_hash text not null check (length(content_hash) > 0),
  fetched_at timestamptz not null,
  extractor_version text not null check (length(extractor_version) > 0),
  extracted_text text,
  created_at timestamptz not null default now()
);

-- The planned worker clears extracted_text after fetched_at + 30 days.
-- Metadata and short evidence excerpts remain while evaluations reference them.
create index source_document_versions_text_retention_idx
  on public.source_document_versions (fetched_at)
  where extracted_text is not null;

create index source_document_versions_source_fetched_idx
  on public.source_document_versions (source_url_id, fetched_at desc);

alter table public.profiles enable row level security;
alter table public.assessment_axes enable row level security;
alter table public.career_profile_versions enable row level security;
alter table public.career_profile_target_roles enable row level security;
alter table public.career_profile_axis_values enable row level security;
alter table public.career_constraints enable row level security;
alter table public.career_constraint_locations enable row level security;
alter table public.companies enable row level security;
alter table public.source_urls enable row level security;
alter table public.job_postings enable row level security;
alter table public.source_document_versions enable row level security;
