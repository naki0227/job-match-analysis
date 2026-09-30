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

OTLP metric names are converted by Grafana Cloud: dots become underscores,
counters gain `_total`, and histograms in seconds gain `_seconds`
(`job_match.jev.duration` → `job_match_jev_duration_seconds_bucket`).
`service.name` becomes the `job` label.
