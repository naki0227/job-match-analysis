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
trap 'rm -f "$profile_log_a" "$profile_log_b" "$evaluation_log_a" "$evaluation_log_b"; cleanup' EXIT INT TERM
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

printf '%s\n' 'Issues #14/#15/#16/#17/#25/#38 migrations, integrity, RLS, atomicity, profile revisions, pagination, and rollback checks passed'
