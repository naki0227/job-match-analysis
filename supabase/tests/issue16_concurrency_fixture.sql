insert into auth.users(id) values ('00000000-0000-0000-0000-000000001621');
insert into public.profiles(id) values ('00000000-0000-0000-0000-000000001621');
insert into public.source_urls(id, raw_url, normalized_url) values
  ('00000000-0000-0000-0000-000000001622',
   'https://example.org/16-concurrent', 'https://example.org/16-concurrent');
insert into public.companies(id, name) values
  ('00000000-0000-0000-0000-000000001623', 'Concurrent Company');
insert into public.evaluation_targets(id, target_type, company_id) values
  ('00000000-0000-0000-0000-000000001624', 'company',
   '00000000-0000-0000-0000-000000001623');
insert into public.analysis_jobs(
  id, source_url_id, analyzer_version, status, worker_token
) values
  ('00000000-0000-0000-0000-000000001625',
   '00000000-0000-0000-0000-000000001622',
   'concurrent-a', 'running', '00000000-0000-0000-0000-000000001627'),
  ('00000000-0000-0000-0000-000000001626',
   '00000000-0000-0000-0000-000000001622',
   'concurrent-b', 'running', '00000000-0000-0000-0000-000000001628');
