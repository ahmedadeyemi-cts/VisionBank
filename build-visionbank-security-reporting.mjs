import fs from "node:fs";
import path from "node:path";

const sourcePath = process.argv[2] || "visionbank-worker-webex-dashboard.js";
const patchPath = process.argv[3] || "webex-daily-report-worker-patch.js";
const outputPath = process.argv[4] || "visionbank-worker-webex-dashboard-reporting.js";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(sourcePath)) fail(`Production Worker source not found: ${sourcePath}`);
if (!fs.existsSync(patchPath)) fail(`Reporting patch not found: ${patchPath}`);

const source = fs.readFileSync(sourcePath, "utf8");
const patch = fs.readFileSync(patchPath, "utf8");

const requiredSourceAnchors = [
  'const WEBEX_DASHBOARD_BUILD = "2026.08.27-v4";',
  'const WEBEX_CENTRAL_TIMEZONE = "America/Chicago";',
  'async function webexSearchPaged(',
  'function paginationArgument(',
  'function getCentralDayStartEpochMs(',
  'function formatWebexEpochCentral(',
  'function formatWebexDurationMs(',
  'async function checkAccess(',
  'function json('
];

for (const anchor of requiredSourceAnchors) {
  if (!source.includes(anchor)) {
    fail(`Expected production anchor missing: ${anchor}`);
  }
}

if (source.includes('/api/webex/daily-reports')) {
  fail("Production Worker already contains /api/webex/daily-reports; refusing duplicate integration.");
}

const routeAnchor = `if (path === "/api/webex/statistics" && method === "GET") {\n  return handleWebexStatistics(request, env, cors);\n}`;

if (!source.includes(routeAnchor)) {
  fail("Could not find the exact Webex statistics route anchor. No file was changed.");
}

const routeAddition = `${routeAnchor}\n\n/** WEBEX DAILY CALL REPORTS - READ ONLY **/\nif (path === "/api/webex/daily-reports" && method === "GET") {\n  return handleWebexDailyReports(request, env, cors);\n}`;

if (!patch.includes("async function handleWebexDailyReports(")) {
  fail("Reporting patch does not contain handleWebexDailyReports().");
}

if (!patch.includes("buildWebexDailyReportPayload")) {
  fail("Reporting patch does not contain the expected report builder.");
}

let integrated = source.replace(routeAnchor, routeAddition);

integrated += `\n\n/* ============================================================\n   BEGIN WEBEX DAILY REPORTING EXTENSION\n   Source: ${path.basename(patchPath)}\n   Integrated by build-visionbank-security-reporting.mjs\n   ============================================================ */\n\n${patch.trim()}\n\n/* END WEBEX DAILY REPORTING EXTENSION */\n`;

const safetyChecks = [
  ['/api/webex/daily-reports', 2], // one live route + one patch documentation reference
  ['async function handleWebexDailyReports(', 1],
  ['const WEBEX_DAILY_REPORT_CACHE_MS', 1],
  ['WEBEX_TOKEN_URL', 1],
  ['WEBEX_REFRESH_EARLY_MS', 1]
];

for (const [needle, expectedMinimum] of safetyChecks) {
  const count = integrated.split(needle).length - 1;
  if (count < expectedMinimum) {
    fail(`Integrated output failed safety check for '${needle}'. Found ${count}.`);
  }
}

fs.writeFileSync(outputPath, integrated, "utf8");

console.log("VisionBank Security reporting candidate created successfully.");
console.log(`Source: ${sourcePath}`);
console.log(`Patch:  ${patchPath}`);
console.log(`Output: ${outputPath}`);
console.log(`Bytes:  ${Buffer.byteLength(integrated, "utf8")}`);
console.log("No Cloudflare deployment was performed by this script.");
