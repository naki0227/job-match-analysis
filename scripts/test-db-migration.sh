#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

container_name="job-match-issue14-$$"
postgres_image="${JOB_MATCH_TEST_POSTGRES_IMAGE:-postgres:17.11-alpine3.24}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm -d --name "$container_name" \
  -e POSTGRES_PASSWORD=localtest "$postgres_image" >/dev/null

ready=false
for _ in $(seq 1 30); do
  # The image's temporary init server accepts Unix-socket connections before
  # it stops and starts the final server. TCP is available only on the latter.
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  printf '%s\n' 'PostgreSQL did not become ready' >&2
  exit 1
fi

psql_cmd() {
  docker exec -i "$container_name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

psql_cmd -c 'create schema auth; create table auth.users (id uuid primary key);'
psql_cmd < supabase/migrations/20260927000100_core_schema.sql
psql_cmd < supabase/migrations/20260927000200_evaluation_match_schema.sql
psql_cmd < supabase/tests/issue14_integrity.sql
psql_cmd < supabase/tests/issue15_auth_fixture.sql
psql_cmd < supabase/migrations/20260928003628_personal_read_rls.sql
psql_cmd < supabase/tests/issue15_rls.sql
psql_cmd < supabase/migrations/20260928031424_commit_career_profile.sql
psql_cmd < supabase/tests/issue16_profile.sql
psql_cmd < supabase/tests/issue25_profile_versions.sql
psql_cmd < supabase/migrations/20260928031425_commit_analysis_evaluation.sql
psql_cmd < supabase/tests/issue16_evaluation.sql
psql_cmd < supabase/tests/issue16_concurrency_fixture.sql
profile_log_a=$(mktemp)
profile_log_b=$(mktemp)
evaluation_log_a=$(mktemp)
evaluation_log_b=$(mktemp)
issue45_guard_log=$(mktemp)
issue19_parallel_log=$(mktemp)
issue20_claim_a=$(mktemp)
issue20_claim_b=$(mktemp)
trap 'rm -f "$profile_log_a" "$profile_log_b" "$evaluation_log_a" "$evaluation_log_b" "$issue45_guard_log" "$issue19_parallel_log" "$issue20_claim_a" "$issue20_claim_b"; cleanup' EXIT INT TERM
set +e
psql_cmd -v key=00000000-0000-0000-0000-000000001629 +  < supabase/tests/issue16_profile_concurrent_call.sql >"$profile_log_a" 2>&1 &
profile_pid_a=$!
psql_cmd -v key=00000000-0000-0000-0000-000000001630 +  < supabase/tests/issue16_profile_concurrent_call.sql >"$profile_log_b" 2>&1 &
profile_pid_b=$!
wait "$profile_pid_a"; profile_status_a=$?
wait "$profile_pid_b"; profile_status_b=$?
set -e
if [ "$((profile_status_a + profile_status_b))" -ne 3 ]; then
  cat "$profile_log_a" "$profile_log_b" >&2
  printf '%s\n' 'Concurrent profile calls did not yield one success and one conflict' >&2
  exit 1
fi
profile_count=$(psql_cmd -Atc "select count(*) from public.career_profile_versions
  where user_id = '00000000-0000-0000-0000-000000001621'")
if [ "$profile_count" != 1 ]; then
  printf '%s\n' 'Concurrent profile calls created duplicate versions' >&2
  exit 1
fi
psql_cmd -v job_id=00000000-0000-0000-0000-000000001625 +  -v worker_token=00000000-0000-0000-0000-000000001627 +  < supabase/tests/issue16_evaluation_concurrent_call.sql >"$evaluation_log_a" 2>&1 &
evaluation_pid_a=$!
psql_cmd -v job_id=00000000-0000-0000-0000-000000001626 +  -v worker_token=00000000-0000-0000-0000-000000001628 +  < supabase/tests/issue16_evaluation_concurrent_call.sql >"$evaluation_log_b" 2>&1 &
evaluation_pid_b=$!
wait "$evaluation_pid_a"
wait "$evaluation_pid_b"
evaluation_count=$(psql_cmd -Atc "select count(*) from public.evaluations
  where target_id = '00000000-0000-0000-0000-000000001624'")
completed_count=$(psql_cmd -Atc "select count(*) from public.analysis_jobs
  where status = 'completed' and evaluation_id in (
    select id from public.evaluations
    where target_id = '00000000-0000-0000-0000-000000001624')")
if [ "$evaluation_count" != 1 ] || [ "$completed_count" != 2 ]; then
  cat "$evaluation_log_a" "$evaluation_log_b" >&2
  printf '%s\n' 'Concurrent evaluation calls did not share one complete evaluation' >&2
  exit 1
fi
psql_cmd < supabase/migrations/20260928125000_saved_jobs_page.sql
psql_cmd < supabase/tests/issue17_saved_jobs_page.sql
issue17_plan=$(psql_cmd -At < supabase/tests/issue17_explain.sql)
if ! printf '%s\n' "$issue17_plan" | grep -Fq 'user_saved_jobs_page_idx'; then
  printf '%s\n' "$issue17_plan" >&2
  printf '%s\n' 'EXPLAIN did not use the saved jobs page index' >&2
  exit 1
fi
psql_cmd < supabase/migrations/20260928161035_optional_profile_education_legal_history.sql
psql_cmd < supabase/tests/issue38_optional_profile_legal.sql
if psql_cmd < supabase/migrations/20260929011641_analysis_history_from_matches.sql >"$issue45_guard_log" 2>&1; then
  printf '%s\n' 'Issue #45 migration discarded existing saved rows' >&2
  exit 1
fi
if ! grep -Fq 'legacy_saved_jobs_not_empty' "$issue45_guard_log"; then
  cat "$issue45_guard_log" >&2
  printf '%s\n' 'Issue #45 migration failed for an unexpected reason' >&2
  exit 1
fi
if [ "$(psql_cmd -Atc 'select count(*) from public.user_saved_jobs')" != '2001' ]; then
  printf '%s\n' 'Issue #45 guard did not preserve legacy saved rows' >&2
  exit 1
fi
psql_cmd -c 'delete from public.user_saved_jobs;'
psql_cmd < supabase/migrations/20260929011641_analysis_history_from_matches.sql
psql_cmd < supabase/tests/issue45_analysis_history.sql
issue45_plan=$(psql_cmd -At < supabase/tests/issue45_explain.sql)
if ! printf '%s\n' "$issue45_plan" | grep -Fq 'Unique'; then
  printf '%s\n' "$issue45_plan" >&2
  printf '%s\n' 'Issue #45 EXPLAIN did not de-duplicate jobs' >&2
  exit 1
fi
psql_cmd < supabase/migrations/20260929022634_request_analysis_singleflight.sql
psql_cmd < supabase/tests/issue19_request_analysis.sql
seq 1 100 | xargs -P 20 -I '{}' docker exec "$container_name" \
  psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select job_id from public.request_analysis(
    'https://example.org/issue19-parallel?utm_source=test',
    'https://example.org/issue19-parallel', 'issue19-v1',
    '2026-09-27T00:00:00Z')" > "$issue19_parallel_log"
if [ "$(wc -l < "$issue19_parallel_log" | tr -d ' ')" != '100' ] \
  || [ "$(sort -u "$issue19_parallel_log" | wc -l | tr -d ' ')" != '1' ] \
  || [ "$(psql_cmd -Atc "select count(*) from public.analysis_jobs j
    join public.source_urls s on s.id = j.source_url_id
    where s.normalized_url = 'https://example.org/issue19-parallel'")" != '1' ]; then
  printf '%s\n' '100 concurrent analysis requests did not share one active job' >&2
  exit 1
fi
psql_cmd < supabase/migrations/20260929025040_analysis_job_lease_claim.sql
psql_cmd < supabase/tests/issue20_job_lease.sql
psql_cmd < supabase/tests/issue20_concurrency_fixture.sql
psql_cmd -Atc "select job_id from public.claim_analysis_job(
  '20000000-0000-4000-8000-000000000006', 60, 2)" > "$issue20_claim_a" &
issue20_pid_a=$!
psql_cmd -Atc "select job_id from public.claim_analysis_job(
  '20000000-0000-4000-8000-000000000007', 60, 2)" > "$issue20_claim_b" &
issue20_pid_b=$!
wait "$issue20_pid_a"
wait "$issue20_pid_b"
if [ "$(cat "$issue20_claim_a" "$issue20_claim_b" | sed '/^$/d' | wc -l | tr -d ' ')" != '1' ] \
  || [ "$(psql_cmd -Atc "select count(*) from public.analysis_jobs j
    join public.source_urls s on s.id = j.source_url_id
    where s.normalized_url = 'https://example.org/issue20-parallel'
      and j.status = 'running' and j.attempts = 1")" != '1' ]; then
  printf '%s\n' 'Concurrent claims did not assign one worker' >&2
  exit 1
fi
psql_cmd < supabase/migrations/20260930010000_resolve_job_evaluation_target.sql
psql_cmd < supabase/tests/issue22_target_resolution.sql
psql_cmd < supabase/migrations/20260930020000_issue43_evaluation_provenance.sql
psql_cmd < supabase/tests/issue43_evaluation_provenance.sql
JOB_MATCH_DB_CONTAINER="$container_name" pnpm --filter api exec node --import tsx ../crawler/tests/job-recovery.integration.ts
psql_cmd < supabase/tests/issue22_evaluation_versions.sql
psql_cmd < supabase/migrations/20260929093000_match_result_rpc.sql
psql_cmd < supabase/tests/match_result_rpc.sql
psql_cmd < supabase/migrations/20260929131358_analysis_history_page_v2.sql
psql_cmd < supabase/tests/issue27_analysis_history_page.sql
psql_cmd < supabase/migrations/20260929133857_personal_analysis_interest.sql
psql_cmd < supabase/tests/issue27_personal_analysis_interest.sql
psql_cmd < supabase/migrations/20260930050000_issue39_match_shares.sql
psql_cmd < supabase/tests/issue39_match_shares.sql
psql_cmd < supabase/migrations/20260930060000_issue42_analysis_quota.sql
psql_cmd < supabase/tests/issue42_analysis_quota.sql
psql_cmd < supabase/migrations/20260930070000_issue42_jev_budget.sql
psql_cmd < supabase/tests/issue42_jev_budget.sql
jev_granted=$(seq 1 50 | xargs -P 20 -I '{}' docker exec "$container_name" \
  psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select public.reserve_jev_budget(1, 20)" | grep -c '^t$' || true)
if [ "$jev_granted" != '20' ] \
  || [ "$(psql_cmd -Atc 'select reserved_units from public.jev_daily_usage')" != '20' ]; then
  printf 'Concurrent Jev reservations granted %s of a 20-unit budget\n' "$jev_granted" >&2
  exit 1
fi
psql_cmd -c 'delete from public.jev_daily_usage;'
psql_cmd < supabase/migrations/20260930080000_issue42_abuse_signals.sql
psql_cmd < supabase/tests/issue42_abuse_signals.sql
psql_cmd < supabase/migrations/20260930120544_service_role_core_privileges.sql
psql_cmd < supabase/tests/service_role_core_privileges.sql
psql_cmd < supabase/migrations/20261001004539_legal_acknowledgement_rpcs.sql
psql_cmd < supabase/tests/legal_acknowledgement_rpcs.sql
psql_cmd < supabase/migrations/20261001014615_legal_documents_v1_0.sql
psql_cmd < supabase/tests/legal_documents_v1_0.sql
legal_rerun_log=$(mktemp)
if psql_cmd < supabase/migrations/20261001014615_legal_documents_v1_0.sql >"$legal_rerun_log" 2>&1; then
  printf '%s\n' 'Re-applying the v1.0 legal documents did not fail' >&2
  exit 1
fi
if ! grep -Fq 'legal_documents v1.0 already exists' "$legal_rerun_log"; then
  cat "$legal_rerun_log" >&2
  printf '%s\n' 'Re-applying the v1.0 legal documents failed for an unexpected reason' >&2
  exit 1
fi
rm -f "$legal_rerun_log"
psql_cmd < supabase/tests/issue29_security.sql
pnpm --filter @job-match/contracts build
pnpm --filter @job-match/domain build
pnpm --filter @job-match/application build
JOB_MATCH_DB_CONTAINER="$container_name" pnpm --filter api exec node --import tsx scripts/test-analysis-parallel.ts
JOB_MATCH_DB_CONTAINER="$container_name" pnpm --filter api exec node --import tsx scripts/test-analysis-history-db.ts
JOB_MATCH_DB_CONTAINER="$container_name" pnpm --filter api exec node --import tsx scripts/test-match-share-db.ts
JOB_MATCH_DB_CONTAINER="$container_name" pnpm --filter api exec node --import tsx scripts/test-account-deletion-db.ts
JOB_MATCH_DB_CONTAINER="$container_name" pnpm --filter api exec node --import tsx scripts/test-legal-db.ts
psql_cmd < supabase/rollback/20261001014615_legal_documents_v1_0.sql
psql_cmd < supabase/tests/legal_documents_v1_0_rollback.sql
psql_cmd < supabase/rollback/20261001004539_legal_acknowledgement_rpcs.sql
psql_cmd < supabase/tests/legal_acknowledgement_rpcs_rollback.sql
psql_cmd < supabase/rollback/20260930120544_service_role_core_privileges.sql
psql_cmd < supabase/tests/service_role_core_privileges_rollback.sql
psql_cmd < supabase/rollback/20260930080000_issue42_abuse_signals.sql
psql_cmd < supabase/tests/issue42_abuse_signals_rollback.sql
psql_cmd < supabase/rollback/20260930070000_issue42_jev_budget.sql
psql_cmd < supabase/tests/issue42_jev_budget_rollback.sql
psql_cmd < supabase/rollback/20260930060000_issue42_analysis_quota.sql
psql_cmd < supabase/tests/issue42_analysis_quota_rollback.sql
psql_cmd < supabase/rollback/20260930050000_issue39_match_shares.sql
psql_cmd < supabase/tests/issue39_match_shares_rollback.sql
psql_cmd < supabase/rollback/20260929133857_personal_analysis_interest.sql
psql_cmd < supabase/tests/issue27_personal_analysis_rollback.sql
psql_cmd < supabase/rollback/20260929131358_analysis_history_page_v2.sql
psql_cmd < supabase/tests/issue27_analysis_history_rollback.sql
psql_cmd < supabase/rollback/20260929_match_result_down.sql
psql_cmd < supabase/tests/match_result_rollback.sql
psql_cmd < supabase/rollback/20260930020000_issue43_evaluation_provenance.sql
psql_cmd < supabase/rollback/20260930010000_resolve_job_evaluation_target.sql
psql_cmd < supabase/rollback/20260929_issue20_down.sql
psql_cmd < supabase/tests/issue20_rollback.sql
psql_cmd < supabase/rollback/20260929_issue19_down.sql
psql_cmd < supabase/tests/issue19_rollback.sql
psql_cmd < supabase/rollback/20260929_issue45_down.sql
psql_cmd < supabase/tests/issue45_rollback.sql
psql_cmd < supabase/rollback/20260928_issue38_down.sql
psql_cmd < supabase/tests/issue38_rollback.sql
psql_cmd < supabase/rollback/20260928_issue17_down.sql
psql_cmd < supabase/rollback/20260928_issue16_evaluation_down.sql
psql_cmd < supabase/rollback/20260928_issue16_profile_down.sql
psql_cmd < supabase/rollback/20260928_issue15_down.sql
psql_cmd < supabase/tests/issue15_rollback.sql
psql_cmd < supabase/rollback/20260927_issue14_down.sql

remaining=$(psql_cmd -Atc "select count(*) from pg_tables where schemaname = 'public'")
if [ "$remaining" != 0 ]; then
  printf 'Rollback left %s public tables\n' "$remaining" >&2
  exit 1
fi

printf '%s\n' 'Issues #14/#15/#16/#17/#19/#20/#22/#25/#38/#45 migrations, integrity, RLS, atomicity, leases, versioned evaluation reuse, singleflight, pagination, history, Match RPC, and rollback checks passed'
