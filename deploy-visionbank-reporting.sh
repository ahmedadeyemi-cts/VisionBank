#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---check}"
SOURCE="${VISIONBANK_SOURCE:-visionbank-worker-webex-agent-v5.js}"
PATCH="${VISIONBANK_REPORT_PATCH:-webex-daily-report-worker-patch.js}"
OUTPUT="${VISIONBANK_REPORT_OUTPUT:-visionbank-worker-webex-dashboard-reporting.js}"
CONFIG="${VISIONBANK_REPORT_CONFIG:-wrangler.visionbank-reporting.jsonc}"
WORKER_NAME="visionbank-security"
EXPECTED_ACCOUNT_ID="8e3117e5e935059805f98211f6868c9c"
INHERIT_SECRETS_FILE="/tmp/visionbank-inherit-secrets.json"

export CLOUDFLARE_ACCOUNT_ID="$EXPECTED_ACCOUNT_ID"

case "$MODE" in
  --check|--deploy) ;;
  *) echo "Usage: $0 [--check|--deploy]" >&2; exit 2 ;;
esac

for file in "$SOURCE" "$PATCH" "$CONFIG" "build-visionbank-security-reporting.mjs"; do
  [[ -f "$file" ]] || { echo "ERROR: required file not found: $file" >&2; exit 1; }
done

if grep -Fq 'const WEBEX_DASHBOARD_BUILD = "2026.08.27-v4";' "$SOURCE"; then
  echo "ERROR: v4 VisionBank Worker detected. Refusing to continue because this would roll back Webex Agent controls." >&2
  exit 1
fi

required_v5_anchors=(
  'const WEBEX_DASHBOARD_BUILD = "2026.08.27-v5";'
  'const WEBEX_AGENT_CONTROL_BUILD = "2026.08.27-v5";'
  'if (path === "/api/webex/agent/auto-logout/run" && method === "POST")'
  'async function runWebexAutoLogoutSchedule('
  'async function runWebexAgentReminderSchedule('
  '["webex-agent-auto-logout", () => runWebexAutoLogoutSchedule(env)]'
  '["webex-agent-reminder", () => runWebexAgentReminderSchedule(env)]'
  'const WEBEX_TOKEN_URL = "https://webexapis.com/v1/access_token";'
  'const WEBEX_REFRESH_EARLY_MS = 15 * 60 * 1000;'
)
for anchor in "${required_v5_anchors[@]}"; do
  grep -Fq "$anchor" "$SOURCE" || { echo "ERROR: v5 production safety anchor missing: $anchor" >&2; exit 1; }
done

node - "$CONFIG" "$OUTPUT" "$EXPECTED_ACCOUNT_ID" <<'NODE'
const fs = require('fs');
const [configPath, expectedMain, expectedAccountId] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
if (config.name !== 'visionbank-security') throw new Error(`Wrong Worker target: ${config.name}`);
if (config.account_id !== expectedAccountId) throw new Error(`Wrong Cloudflare account_id: ${config.account_id || '(missing)'}`);
if (config.main !== expectedMain) throw new Error(`Wrong Worker main: ${config.main}`);
if (config.keep_vars !== true) throw new Error('keep_vars must be true.');
if ('triggers' in config) throw new Error('Reporting config must leave triggers undefined so deployed cron triggers are preserved.');
if ('secrets' in config) throw new Error('Reporting config must not declare secrets.required; version binding validation is used instead.');
console.log(`Cloudflare account verified: ${config.account_id}`);
console.log(`Config target verified: ${config.name}`);
console.log(`Config main verified: ${config.main}`);
console.log('Secret preservation mode verified: no secrets.required declaration.');
NODE

echo "Checking Cloudflare authentication/account..."
npx wrangler whoami 2>&1 | tee /tmp/visionbank-wrangler-whoami.txt
grep -Fq "$EXPECTED_ACCOUNT_ID" /tmp/visionbank-wrangler-whoami.txt || { echo "ERROR: Wrangler is not authenticated to expected Cloudflare account ${EXPECTED_ACCOUNT_ID}." >&2; exit 1; }
echo "Wrangler account check passed: ${EXPECTED_ACCOUNT_ID}."

get_active_version_id() {
  local status_file="$1"
  npx wrangler deployments status --name "$WORKER_NAME" --json > "$status_file"
  node - "$status_file" <<'NODE'
const fs = require('fs');
const [file] = process.argv.slice(2);
const deployment = JSON.parse(fs.readFileSync(file, 'utf8'));
const active = (Array.isArray(deployment?.versions) ? deployment.versions : []).filter(v => Number(v.percentage) === 100 && v.version_id);
if (active.length !== 1) throw new Error(`Expected exactly one 100%-serving version; found ${active.length}.`);
process.stdout.write(active[0].version_id);
NODE
}

validate_version_bindings() {
  local version_id="$1"
  local label="$2"
  local outfile="$3"

  echo "Inspecting ${label} version ${version_id}..."
  npx wrangler versions view "$version_id" --name "$WORKER_NAME" --json | tee "$outfile"

  node - "$CONFIG" "$outfile" "$label" <<'NODE'
const fs = require('fs');
const [configPath, versionPath, label] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
const version = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
const bindings = version?.resources?.bindings;
if (!Array.isArray(bindings) || bindings.length === 0) throw new Error(`${label} version returned no bindings.`);
const byName = new Map(bindings.map(binding => [binding.name, binding]));
const requiredSecrets = ['ALIANZA_PASSWORD','BREVO_API_KEY','CC_API_TOKEN','CCM_PASSWORD','PDFSHIFT_API_KEY','WEBEX_ACCESS_TOKEN','WEBEX_CLIENT_SECRET','WEBEX_REFRESH_TOKEN'];
for (const name of requiredSecrets) {
  const binding = byName.get(name);
  if (!binding) throw new Error(`${label} secret binding is missing: ${name}`);
  if (binding.type !== 'secret_text') throw new Error(`${label} binding ${name} must be secret_text, found ${binding.type}`);
}
for (const expected of (config.kv_namespaces || [])) {
  const binding = byName.get(expected.binding);
  if (!binding) throw new Error(`${label} KV binding is missing: ${expected.binding}`);
  if (binding.type !== 'kv_namespace') throw new Error(`${label} binding ${expected.binding} must be kv_namespace, found ${binding.type}`);
  if (binding.namespace_id !== expected.id) throw new Error(`${label} KV namespace mismatch for ${expected.binding}: ${binding.namespace_id} != ${expected.id}`);
}
for (const [name, expectedValue] of Object.entries(config.vars || {})) {
  const binding = byName.get(name);
  if (!binding) throw new Error(`${label} plain-text binding is missing: ${name}`);
  if (binding.type !== 'plain_text') throw new Error(`${label} binding ${name} must be plain_text, found ${binding.type}`);
  if (String(binding.text) !== String(expectedValue)) throw new Error(`${label} value mismatch for ${name}.`);
}
const handlers = version?.resources?.script?.handlers || [];
for (const handler of ['fetch', 'scheduled']) if (!handlers.includes(handler)) throw new Error(`${label} Worker is missing required handler: ${handler}`);
console.log(`${label} binding validation passed (${bindings.length} total bindings).`);
console.log(`Secret bindings verified: ${requiredSecrets.length}/${requiredSecrets.length}.`);
console.log(`KV bindings verified: ${(config.kv_namespaces || []).length}/${(config.kv_namespaces || []).length}.`);
console.log(`Plain-text vars verified: ${Object.keys(config.vars || {}).length}/${Object.keys(config.vars || {}).length}.`);
NODE
}

echo "Inspecting current ${WORKER_NAME} deployment..."
npx wrangler deployments status --name "$WORKER_NAME" --json | tee /tmp/visionbank-deployment-status.json

echo "Inspecting recent ${WORKER_NAME} versions..."
npx wrangler versions list --name "$WORKER_NAME" --json | tee /tmp/visionbank-versions-list.json

ACTIVE_VERSION_ID="$(get_active_version_id /tmp/visionbank-deployment-status-current.json)"
echo "Active production version: ${ACTIVE_VERSION_ID}"
validate_version_bindings "$ACTIVE_VERSION_ID" "Active production" /tmp/visionbank-active-version.json

echo "Building integrated VisionBank Security reporting Worker..."
node --check build-visionbank-security-reporting.mjs
node build-visionbank-security-reporting.mjs "$SOURCE" "$PATCH" "$OUTPUT"
node --check "$OUTPUT"

required_output_anchors=(
  'const WEBEX_DASHBOARD_BUILD = "2026.08.27-v5";'
  'const WEBEX_AGENT_CONTROL_BUILD = "2026.08.27-v5";'
  '/api/webex/agent/auto-logout/run'
  'runWebexAutoLogoutSchedule'
  'runWebexAgentReminderSchedule'
  'WEBEX_TOKEN_URL'
  'WEBEX_REFRESH_EARLY_MS'
  'if (path === "/api/webex/daily-reports" && method === "GET")'
  'async function handleWebexDailyReports('
)
for anchor in "${required_output_anchors[@]}"; do
  grep -Fq "$anchor" "$OUTPUT" || { echo "ERROR: generated Worker preservation check failed: $anchor" >&2; exit 1; }
done

# Passing an empty secrets file makes Wrangler use additive secret inheritance.
printf '{}\n' > "$INHERIT_SECRETS_FILE"

echo "Running candidate-upload dry-run against dedicated reporting config..."
npx wrangler versions upload --config "$CONFIG" --secrets-file "$INHERIT_SECRETS_FILE" --keep-vars --dry-run

echo "All pre-deployment checks passed."
if [[ "$MODE" != "--deploy" ]]; then
  echo "CHECK-ONLY MODE: no Cloudflare version was uploaded or deployed."
  echo "To perform the controlled upload/validate/promote release, run: bash $0 --deploy"
  exit 0
fi

ROLLBACK_VERSION_ID="$ACTIVE_VERSION_ID"
BEFORE_VERSIONS_FILE="/tmp/visionbank-versions-before-candidate.json"
AFTER_VERSIONS_FILE="/tmp/visionbank-versions-after-candidate.json"
npx wrangler versions list --name "$WORKER_NAME" --json > "$BEFORE_VERSIONS_FILE"

CANDIDATE_TAG="webex-daily-reports-$(date -u +%Y%m%dT%H%M%SZ)"
echo "Uploading candidate version with zero production traffic..."
echo "Candidate tag: ${CANDIDATE_TAG}"
npx wrangler versions upload --config "$CONFIG" \
  --secrets-file "$INHERIT_SECRETS_FILE" \
  --keep-vars \
  --tag "$CANDIDATE_TAG" \
  --message "Webex daily reports candidate"

npx wrangler versions list --name "$WORKER_NAME" --json > "$AFTER_VERSIONS_FILE"
CANDIDATE_VERSION_ID="$(node - "$BEFORE_VERSIONS_FILE" "$AFTER_VERSIONS_FILE" "$CANDIDATE_TAG" <<'NODE'
const fs = require('fs');
const [beforePath, afterPath, tag] = process.argv.slice(2);
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
const beforeIds = new Set((Array.isArray(before) ? before : []).map(v => v.id));
const candidates = (Array.isArray(after) ? after : []).filter(v => {
  const ann = v.annotations || {};
  return !beforeIds.has(v.id) && (!ann['workers/tag'] || ann['workers/tag'] === tag);
});
if (candidates.length !== 1) {
  throw new Error(`Expected exactly one newly uploaded candidate version; found ${candidates.length}.`);
}
process.stdout.write(candidates[0].id);
NODE
)"

echo "Candidate version uploaded: ${CANDIDATE_VERSION_ID}"
echo "Validating candidate bindings BEFORE promotion..."
set +e
validate_version_bindings "$CANDIDATE_VERSION_ID" "Candidate" /tmp/visionbank-candidate-version.json
CANDIDATE_VALIDATION_RC=$?
set -e
if [[ $CANDIDATE_VALIDATION_RC -ne 0 ]]; then
  echo "ERROR: candidate binding validation failed. Candidate will NOT receive production traffic." >&2
  echo "Production remains on ${ROLLBACK_VERSION_ID} at 100%." >&2
  exit 1
fi

echo "Candidate binding validation passed. Promoting ${CANDIDATE_VERSION_ID} to 100%..."
npx wrangler versions deploy "${CANDIDATE_VERSION_ID}@100%" --name "$WORKER_NAME" -y

NEW_VERSION_ID="$(get_active_version_id /tmp/visionbank-deployment-status-after-promotion.json)"
if [[ "$NEW_VERSION_ID" != "$CANDIDATE_VERSION_ID" ]]; then
  echo "ERROR: promoted version mismatch. Expected ${CANDIDATE_VERSION_ID}, found ${NEW_VERSION_ID}. Rolling back." >&2
  npx wrangler versions deploy "${ROLLBACK_VERSION_ID}@100%" --name "$WORKER_NAME" -y
  exit 1
fi

set +e
validate_version_bindings "$NEW_VERSION_ID" "Post-promotion" /tmp/visionbank-post-promotion-version.json
POST_PROMOTION_RC=$?
set -e
if [[ $POST_PROMOTION_RC -ne 0 ]]; then
  echo "ERROR: post-promotion binding validation failed. Rolling back to ${ROLLBACK_VERSION_ID} at 100%." >&2
  npx wrangler versions deploy "${ROLLBACK_VERSION_ID}@100%" --name "$WORKER_NAME" -y
  ROLLED_BACK_VERSION_ID="$(get_active_version_id /tmp/visionbank-deployment-status-rollback.json)"
  if [[ "$ROLLED_BACK_VERSION_ID" != "$ROLLBACK_VERSION_ID" ]]; then
    echo "CRITICAL: rollback verification failed. Expected ${ROLLBACK_VERSION_ID}, found ${ROLLED_BACK_VERSION_ID}." >&2
    exit 1
  fi
  echo "Rollback verified: ${ROLLBACK_VERSION_ID} is serving 100%." >&2
  exit 1
fi

echo "Worker candidate upload, pre-promotion validation, promotion, and post-promotion validation passed."
echo "Previous rollback version: ${ROLLBACK_VERSION_ID}"
echo "New active version: ${NEW_VERSION_ID}"
echo "DO NOT publish the Webex report UI yet. Validate /api/webex/daily-reports first."
