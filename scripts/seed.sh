#!/usr/bin/env bash
# Seeds a dedicated `ui-demo` project into a local OpenBao for the console prototype.
# Idempotent: safe to re-run. Never prints token/secret values.
set -euo pipefail
cd "$(dirname "$0")/.."

ADDR=${BAO_ADDR:-${VITE_BAO_ADDR:-http://127.0.0.1:8200}}
if [ -z "${BAO_TOKEN:-}" ] && [ -f ../openbao-poc/.secrets/init.json ]; then
  BAO_TOKEN=$(jq -r '.root_token // empty' ../openbao-poc/.secrets/init.json)
fi
[ -n "${BAO_TOKEN:-}" ] || { echo "Set BAO_TOKEN (or keep ../openbao-poc/.secrets/init.json)." >&2; exit 1; }

api() {
  local method=$1 path=$2 data=${3:-}
  local -a args=(-fsS -X "$method" -H "X-Vault-Token: $BAO_TOKEN" "$ADDR/v1/$path")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  curl "${args[@]}" >/dev/null
}
status() {
  local path=$1
  curl -sS -o /dev/null -w '%{http_code}' -H "X-Vault-Token: $BAO_TOKEN" "$ADDR/v1/$path"
}

# Engines (already present in the POC; safe on a fresh dev server).
[ "$(status sys/mounts/kv)" = 200 ] || api POST sys/mounts/kv "$(jq -nc '{type:"kv",options:{version:"2"}}')"
[ "$(status sys/mounts/totp)" = 200 ] || api POST sys/mounts/totp "$(jq -nc '{type:"totp"}')"

# One environment per tier, two services, two versions for the dev service.
for env in development staging production; do
  api POST "kv/data/ui-demo/env/$env/web" "$(jq -nc \
    --arg env "$env" \
    '{data:{APP_NAME:"console-demo",LOG_LEVEL:(if $env=="production" then "warn" else "debug" end),FEATURE_BANNER:(if $env=="production" then "false" else "true" end),DATABASE_URL:"postgres://db.internal:5432/app",API_BASE_URL:(if $env=="production" then "https://api.example.com" else "https://api."+$env+".example.com" end)}}')"
  api POST "kv/data/ui-demo/env/$env/billing" "$(jq -nc \
    --arg env "$env" \
    '{data:{STRIPE_MODE:(if $env=="production" then "live" else "test" end),INVOICE_PREFIX:(if $env=="production" then "INV" else "TEST-INV" end),REPORT_EMAIL:"finance@example.com"}}')"
done
# A second version so version history is visible on first load.
api POST kv/data/ui-demo/env/development/web "$(jq -nc '{data:{APP_NAME:"console-demo",LOG_LEVEL:"trace",FEATURE_BANNER:"true",DATABASE_URL:"postgres://db.internal:5432/app",API_BASE_URL:"https://api.development.example.com",DEBUG_EXTRA:"only-in-v2"}}')"

# Folder-model demo: nested KV paths that map to Project -> Environment -> Folder -> Secret.
# UI metadata is stored on the KV v2 metadata endpoint (tags, comments, personal overrides).
for env in development staging production; do
  api POST "kv/data/ui-demo/env/$env/database/postgres" "$(jq -nc --arg env "$env" '{
    data: {
      HOST: (if $env=="production" then "pg-prod.internal" else "pg-"+$env+".internal" end),
      PORT: "5432",
      DATABASE: "app",
      USERNAME: "app_user",
      PASSWORD: (if $env=="production" then "prod-only-value" else "dev-only-value" end)
    }
  }')"
  api POST "kv/metadata/ui-demo/env/$env/database/postgres" "$(jq -nc '{
    custom_metadata: {
      ui_tags: "[\"database\",\"critical\"]",
      ui_comments: "{\"PASSWORD\":\"Rotate with the DBA team; never paste into tickets.\"}",
      ui_overrides: "{\"ui-manager\":{\"PASSWORD\":\"manager-local-override\"}}"
    }
  }')"
  api POST "kv/data/ui-demo/env/$env/api/gateway" "$(jq -nc --arg env "$env" '{
    data: {
      BASE_URL: (if $env=="production" then "https://api.example.com" else "https://api."+$env+".example.com" end),
      UPSTREAM: "${database/postgres.HOST}:${database/postgres.PORT}",
      TIMEOUT_MS: "5000"
    }
  }')"
  api POST "kv/metadata/ui-demo/env/$env/api/gateway" "$(jq -nc '{custom_metadata:{ui_tags:"[\"api\",\"network\"]"}}')"
  api POST "kv/data/ui-demo/env/$env/frontend/flags" "$(jq -nc --arg env "$env" '{
    data: {
      WELCOME_TEXT: "Welcome to ui-demo\nSecond line\nThird line",
      ENABLED: (if $env=="production" then "false" else "true" end)
    }
  }')"
  api POST "kv/metadata/ui-demo/env/$env/frontend/flags" "$(jq -nc '{custom_metadata:{ui_tags:"[\"frontend\"]"}}')"
done

# A later version so version history, diffs and rollback have a realistic fixture.
# Fields are added/changed rather than removed so promotion stays simple.
for env in development staging; do
  api POST "kv/data/ui-demo/env/$env/api/gateway" "$(jq -nc --arg env "$env" '{
    data: {
      BASE_URL: ("https://api."+$env+".example.com"),
      UPSTREAM: "${database/postgres.HOST}:${database/postgres.PORT}",
      TIMEOUT_MS: "8000",
      RETRIES: "3"
    }
  }')"
  api POST "kv/data/ui-demo/env/$env/database/postgres" "$(jq -nc --arg env "$env" '{
    data: {
      HOST: ("pg-"+$env+".internal"),
      PORT: "5432",
      DATABASE: "app",
      USERNAME: "app_user",
      PASSWORD: "dev-only-value",
      MAX_CONNECTIONS: "20"
    }
  }')"
done

api POST kv/data/ui-demo/creds/example-console "$(jq -nc '{data:{username:"demo-user",password:"demo-only-password",url:"https://console.example.com"}}')"
api POST kv/data/_runbooks/ui-demo "$(jq -nc '{
  data: {
    title: "ui-demo rotation & promotion",
    summary: "Safe order of operations for the demo credentials and environment promotion.",
    owner: "Platform team",
    rotation: "Quarterly",
    steps: [
      "Open the development web secret and note the current version in the version history.",
      "Rotate the shared credential, then update the username and password fields in development.",
      "Read a fresh one-time code from the example console account to confirm the credential works.",
      "Promote development to staging, verify, then promote staging to production.",
      "Review the recent activity panel to confirm who made each change."
    ],
    links: [{label:"OpenBao UI",url:"http://127.0.0.1:8200/ui"}],
    secrets: [
      {project:"ui-demo",env:"development",service:"web",label:"development · web"},
      {project:"ui-demo",env:"staging",service:"web",label:"staging · web"},
      {project:"ui-demo",env:"production",service:"web",label:"production · web"}
    ]
  }
}')"

# TOTP shared account: seed is generated inside OpenBao and cannot be read back.
if [ "$(status totp/keys/ui-demo--example-console)" != 200 ]; then
  api POST totp/keys/ui-demo--example-console "$(jq -nc '{generate:true,exported:false,issuer:"OpenBao Demo",account_name:"example-console",period:30}')"
fi

# A read-only manager login with a deliberately simple dev-only password.
api POST sys/policies/acl/ui-demo-manager "$(jq -nc --arg policy '
path "auth/token/lookup-self" { capabilities = ["read"] }
path "sys/capabilities-self" { capabilities = ["update"] }
path "kv/metadata/" { capabilities = ["list"] }
path "kv/metadata/ui-demo" { capabilities = ["list"] }
path "kv/metadata/ui-demo/" { capabilities = ["list"] }
path "kv/metadata/ui-demo/env/" { capabilities = ["list"] }
path "kv/metadata/ui-demo/env/*" { capabilities = ["list"] }
path "kv/metadata/ui-demo/env/**" { capabilities = ["list","read"] }
path "kv/metadata/ui-demo/creds/" { capabilities = ["list"] }
path "kv/data/ui-demo/env/development/*" { capabilities = ["read"] }
path "kv/data/ui-demo/env/development/**" { capabilities = ["read"] }
path "kv/data/ui-demo/env/staging/*" { capabilities = ["read"] }
path "kv/data/ui-demo/env/staging/**" { capabilities = ["read"] }
path "kv/data/ui-demo/creds/*" { capabilities = ["read"] }
path "totp/code/ui-demo--*" { capabilities = ["read"] }
' '{policy:$policy}')"
api POST auth/userpass/users/ui-manager "$(jq -nc '{password:"demo-only",policies:["ui-demo-manager"],token_ttl:"8h"}')"

echo "Seeded ui-demo into $ADDR (project tiers, 2 services, 1 shared credential, 1 TOTP account)."
echo "Manager login: ui-manager / demo-only (local development only)."
