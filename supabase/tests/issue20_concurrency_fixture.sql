update public.analysis_jobs
  set status = 'failed', worker_token = null, lease_until = null
  where status in ('queued', 'running');
insert into public.source_urls(raw_url, normalized_url)
  values ('https://example.org/issue20-parallel',
    'https://example.org/issue20-parallel');
insert into public.analysis_jobs(source_url_id, analyzer_version, status, created_at)
  select id, 'issue20-parallel', 'queued', '2019-01-01T00:00:00Z'
  from public.source_urls
  where normalized_url = 'https://example.org/issue20-parallel';
