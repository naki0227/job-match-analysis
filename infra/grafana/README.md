# Grafana dashboards

Dashboards as code for Grafana Cloud Free (ADR-041). Import each JSON file
through Dashboards → New → Import and keep the folder layout:

| Folder | Files | Data source |
|---|---|---|
| `Operations/` | `dashboards/operations/*.json` | Grafana Cloud Prometheus (OTLP metrics from API and crawler) |
| `Product Analytics/` | `dashboards/product-analytics/*.json` | PostgreSQL with the read-only analytics role (ADR-043) |

Operations dashboards only use route templates, methods, status codes and
outcomes. Never add panels or variables keyed by user ids, share tokens, raw
paths, IP/User-Agent values or their HMACs.

Product Analytics dashboards query only views in the `analytics` schema
through a login user that has nothing but the `analytics_reader` role
(ADR-043). Never point them at a role with access to `public` tables.

OTLP metric names are converted by Grafana Cloud: dots become underscores,
counters gain `_total`, and histograms in seconds gain `_seconds`
(`job_match.jev.duration` → `job_match_jev_duration_seconds_bucket`).
`service.name` becomes the `job` label.

## Alerts

`alerts/operations.yaml` holds Prometheus-style rules for the Grafana Cloud
metrics ruler (`mimirtool rules load infra/grafana/alerts/operations.yaml`).
Rules use the same labels as the dashboards; never add user ids, request ids
or job ids to alert labels.

## Traces and logs correlation

API spans carry `job_match.request_id` (the `X-Request-ID` response header,
also logged in `match_unavailable` events) and, on job routes,
`job_match.job_id`. Crawler `analysis_job` spans carry `job_match.job_id`,
`job_match.attempt`, `job_match.outcome` and the error class name only.
Every Supabase call is a `supabase <operation>` client span where the
operation is `rpc:<name>`, `table:<name>` or `auth:<segment>`; query
parameters and bodies are never recorded. Search Tempo by request id or job
id to follow one comparison or analysis across API, crawler and database.

| Metric (Grafana name) | Labels |
|---|---|
| `job_match_db_request_duration_seconds` | `job`, `db_operation`, `outcome` (`ok`/`error`/`network_error`) |
| `job_match_analysis_job_queued` | `job` |
| `job_match_analysis_job_expired_leases` | `job` |
