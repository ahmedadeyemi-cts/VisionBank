#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---check}"
SOURCE="${VISIONBANK_SOURCE:-visionbank-worker-webex-agent-v5.js}"
PATCH="${VISIONBANK_REPORT_PATCH:-webex-daily-report-worker-patch.js}"
OUTPUT="${VISIONBANK_REPORT_OUTPUT:-visionbank-worker-webex-dashboard-reporting.js}"
CONFIG="${VISIONBANK_REPORT_CONFIG:-wrangler.visionbank-reporting.jsonc}"
WORKER_NAME="visionbank-security"
EXPECTED_ACCOUNT_ID="8e3117e5e935059805f98211f6868c9c"

# Force every Wrangler command in this release to the verified VisionBank Cloudflare account.
export CLOUDFLARE_ACCOUNT_ID="$EXPECTED_ACCOUNT_ID"

case "$MODE" in
  --check|--deploy) ;;
  *)
    echo "Usage: $0 [--check|--deploy]" >&2
    exit 2
    ;;
esac

for file in "$SOURCE" "$PATCH" "$CONFIG" "build-visionbank-security-reporting.mjs"; do
  if [[ ! -f "$file" ]]; then
    echo "ERROR: required file not found: $file" >&2
    exit 1
  fi
done

# Fail closed if anyone points this release at the old v4 Worker.
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
  if ! grep -Fq "$anchor" "$SOURCE"; then
    echo "ERROR: v5 production safety anchor missing: $anchor" >&2
    exit 1
  fi
done

# Confirm the deployment config cannot target another account or standalone webex-agent Worker.
node - "$CONFIG" "$OUTPUT" "$EXPECTED_ACCOUNT_ID" <<'NODE'
const fs = require('fs');
const [configPath, expectedMain, expectedAccountId] = process.argv.slice(2);
const raw = fs.readFileSync(configPath, 'utf8');
const noComments = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const config = JSON.parse(noComments);
if (config.name !== 'visionbank-security') {
  throw new Error(`Wrong Worker target: ${config.name}`);
}
if (config.account_id !== expectedAccountId) {
  throw new Error(`Wrong Cloudflare account_id: ${config.account_id || '(missing)'}`);
}
if (config.main !== expectedMain) {
  throw new Error(`Wrong Worker main: ${config.main}`);
}
if (config.keep_vars !== true) {
  throw new Error('keep_vars must be true.');
}
if ('triggers' in config) {
  throw new Error('Reporting config must leave triggers undefined so deployed cron triggers are preserved.');
}
console.log(`Cloudflare account verified: ${config.account_id}`);
console.log(`Config target verified: ${config.name}`);
console.log(`Config main verified: ${config.main}`);
NODE

# Verify Cloudflare authentication and exact account before reading or writing Worker state.
echo "Checking Cloudflare authentication/account..."
npx wrangler whoami 2>&1 | tee /tmp/visionbank-wrangler-whoami.txt
if ! grep -Fq "$EXPECTED_ACCOUNT_ID" /tmp/visionbank-wrangler-whoami.txt; then
  echo "ERROR: Wrangler is not authenticated to expected Cloudflare account ${EXPECTED_ACCOUNT_ID}." >&2
  exit 1
fi
echo "Wrangler account check passed: ${EXPECTED_ACCOUNT_ID}."

# Inspect the currently active deployment and recent Worker versions BEFORE any write.
echo "Inspecting current ${WORKER_NAME} deployment..."
npx wrangler deployments status --name "$WORKER_NAME" --json \
  | tee /tmp/visionbank-deployment-status.json

echo "Inspecting recent ${WORKER_NAME} versions..."
npx wrangler versions list --name "$WORKER_NAME" --json \
  | tee /tmp/visionbank-versions-list.json

node - <<'NODE'
const fs = require('fs');
for (const [label, file] of [
  ['deployment status', '/tmp/visionbank-deployment-status.json'],
  ['versions list', '/tmp/visionbank-versions-list.json']
]) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || (Array.isArray(value) && value.length === 0)) {
    throw new Error(`Cloudflare ${label} returned no data for visionbank-security.`);
  }
}
console.log('Live Worker deployment/version inspection passed.');
NODE

# Verify required secret NAMES only. Secret values are never read or printed.
echo "Checking required secret names on ${WORKER_NAME}..."
npx wrangler secret list --name "$WORKER_NAME" --format json > /tmp/visionbank-secret-list.json
node - <<'NODE'
const fs = require('fs');
const required = [
  'ALIANZA_PASSWORD',
  'BREVO_API_KEY',
  'CC_API_TOKEN',
  'CCM_PASSWORD',
  'PDFSHIFT_API_KEY',
  'WEBEX_ACCESS_TOKEN',
  'WEBEX_CLIENT_SECRET',
  'WEBEX_REFRESH_TOKEN'
];
const raw = JSON.parse(fs.readFileSync('/tmp/visionbank-secret-list.json', 'utf8'));
const list = Array.isArray(raw) ? raw : (raw.secrets || raw.result || []);
const names = new Set(list.map(x => typeof x === 'string' ? x : (x.name || x.binding || x.key)).filter(Boolean));
const missing = required.filter(name => !names.has(name));
if (missing.length) throw new Error(`Missing required Cloudflare secret name(s): ${missing.join(', ')}`);
console.log(`Required secret-name check passed (${required.length}/${required.length}).`);
NODE

# Build from the combined v5 Worker only.
echo "Building integrated VisionBank Security reporting Worker..."
node --check build-visionbank-security-reporting.mjs
node build-visionbank-security-reporting.mjs "$SOURCE" "$PATCH" "$OUTPUT"
node --check "$OUTPUT"

# Verify the generated output retained automatic sign-out, reminders, OAuth and the new report route.
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
  if ! grep -Fq "$anchor" "$OUTPUT"; then
    echo "ERROR: generated Worker preservation check failed: $anchor" >&2
    exit 1
  fi
done

echo "Running Wrangler dry-run against dedicated reporting config..."
npx wrangler deploy --config "$CONFIG" --dry-run

echo "All pre-deployment checks passed."

if [[ "$MODE" != "--deploy" ]]; then
  echo "CHECK-ONLY MODE: no Cloudflare deployment performed."
  echo "To perform the controlled Worker-first deployment, run: $0 --deploy"
  exit 0
fi

echo "Deploying ONLY ${WORKER_NAME} in account ${EXPECTED_ACCOUNT_ID} using ${CONFIG}..."
npx wrangler deploy --config "$CONFIG"

echo "Worker deployment command completed."
echo "DO NOT publish the Webex report UI yet. Validate /api/webex/daily-reports first."
