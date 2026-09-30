# Azure Container Apps Job（crawler）の作成とAPIからの起動

ADR-040の構成。jobの正本はPostgreSQLで、Azure Jobは「queueが空になるまで処理して終了する」workerの起動契機だけを担う。

## 1. Jobを作る（Cloud Shell）

```bash
RG=job-match-prod
ENV_NAME=<Container Apps環境名>   # az containerapp env list -g $RG -o table
JOB=job-match-crawler
DIGEST=<Images summaryのjob-match-crawler@sha256:...のdigest>

az containerapp job create -g $RG -n $JOB --environment $ENV_NAME \
  --trigger-type Manual --replica-timeout 1800 --replica-retry-limit <再試行回数> \
  --parallelism 1 --replica-completion-count 1 \
  --image ghcr.io/naki0227/job-match-crawler@$DIGEST \
  --cpu 1 --memory 2Gi \
  --secrets supabase-secret=<SUPABASE_SECRET_KEY> jev-key=<JEV_API_KEY> \
  --env-vars SUPABASE_URL=<SUPABASE_URL> SUPABASE_SECRET_KEY=secretref:supabase-secret \
    JEV_API_KEY=secretref:jev-key CRAWLER_RUN_MODE=drain CRAWLER_DRAIN_MAX_JOBS=<運用値> \
    CRAWLER_LEASE_SECONDS=<運用値> CRAWLER_MAX_ATTEMPTS=<運用値> CRAWLER_RETENTION_BATCH_SIZE=<運用値> \
    CRAWLER_MAX_CANDIDATES=<運用値> CRAWLER_MAX_EXCERPT_CHARS=<運用値> \
    CRAWLER_POLL_INTERVAL_MS=<運用値> CRAWLER_JEV_DAILY_CANDIDATE_BUDGET=unlimited
```

### 現在の本番値（2026年09月30日に記録。運用値としては未確定）

初回作成時の値で、実測に基づいて決めたものではない。Playwrightの実測とJobの実行時間・失敗率を見て見直す。runbookの過去版に書いた例（retry 0、lease 300、drain 20、poll 5000）は採用していない。

| 設定 | 本番の値 |
|---|---|
| `--replica-retry-limit` | 1 |
| `--replica-timeout` | 1800 |
| parallelism / completion count | 1 / 1 |
| CPU / memory | 1.0 / 2Gi |
| `CRAWLER_LEASE_SECONDS` | 600 |
| `CRAWLER_MAX_ATTEMPTS` | 3 |
| `CRAWLER_RETENTION_BATCH_SIZE` | 100 |
| `CRAWLER_MAX_CANDIDATES` | 8 |
| `CRAWLER_MAX_EXCERPT_CHARS` | 120 |
| `CRAWLER_POLL_INTERVAL_MS` | 1000（drainでは未使用） |
| `CRAWLER_DRAIN_MAX_JOBS` | 10 |
| `CRAWLER_JEV_DAILY_CANDIDATE_BUDGET` | `unlimited` |

注意: `--replica-retry-limit`が1なので、失敗した実行はAzureが1回だけ再実行する。jobの再試行回数はDBの`attempts`（`CRAWLER_MAX_ATTEMPTS`）が決めるため、二重処理にはならない。

- `CRAWLER_BROWSER_EXECUTABLE`はimageのentrypointが設定するので不要。
- DBには`20260930120544_service_role_core_privileges`までのmigrationが必要（未適用だと`permission denied for table source_document_versions`（42501）で`error after 0 jobs`になる）。
- `--replica-timeout`はdrainの上限時間。`CRAWLER_DRAIN_MAX_JOBS`と合わせて、1回の実行が長引かないようにする。
- 手動の試運転: `az containerapp job start -g $RG -n $JOB`、結果は`az containerapp job execution list -g $RG -n $JOB -o table`（Log Analyticsなしのため、ログはGrafana/OTel側で見る）。

## 2. APIにJobの起動だけを許可する

```bash
az containerapp identity assign -g $RG -n job-match-api --system-assigned
API_PRINCIPAL=$(az containerapp show -g $RG -n job-match-api --query identity.principalId -o tsv)
JOB_ID=$(az containerapp job show -g $RG -n $JOB --query id -o tsv)
SUB=$(az account show --query id -o tsv)

cat > job-starter.json <<JSON
{
  "Name": "Job Match Crawler Job Starter",
  "Description": "Start the crawler Container Apps Job only",
  "Actions": ["Microsoft.App/jobs/start/action"],
  "AssignableScopes": ["/subscriptions/$SUB/resourceGroups/$RG"]
}
JSON
az role definition create --role-definition job-starter.json
az role assignment create --assignee-object-id $API_PRINCIPAL \
  --assignee-principal-type ServicePrincipal \
  --role "Job Match Crawler Job Starter" --scope $JOB_ID
```

## 3. APIの環境変数

```bash
az containerapp update -g $RG -n job-match-api --set-env-vars \
  AZURE_SUBSCRIPTION_ID=$SUB AZURE_RESOURCE_GROUP=$RG \
  CRAWLER_AZURE_JOB_NAME=$JOB CRAWLER_TRIGGER_COOLDOWN_SECONDS=60
```

`IDENTITY_ENDPOINT`・`IDENTITY_HEADER`はmanaged identityを有効にするとContainer Appsが自動で入れる。4つのうち1つでも欠けると起動は無効（`disabled`）のまま。role assignmentの反映には数分かかることがある。

## 4. 確認

1. Webで未分析のURLを1件送る→`pending`
2. `az containerapp job execution list -g $RG -n $JOB -o table`に新しい実行が出る
3. 数十秒〜数分で分析が完了し、Jobの実行が`Succeeded`で終わる
4. 同じURLを続けて送っても、cooldown中はJobが増えない

## 5. crawler imageの更新

現時点ではJobのdeployは自動化していない。新しいdigestへ手動で更新する:
`az containerapp job update -g $RG -n $JOB --image ghcr.io/naki0227/job-match-crawler@<digest>`
