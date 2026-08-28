import fs from "node:fs";
import path from "node:path";

// IMPORTANT: the reporting release must be integrated into the combined v5
// visionbank-security Worker. v4 predates the Webex Agent controls and scheduled
// automatic sign-out work and must never be used as a deployment baseline.
const sourcePath = process.argv[2] || "visionbank-worker-webex-agent-v5.js";
const patchPath = process.argv[3] || "webex-daily-report-worker-patch.js";
const outputPath = process.argv[4] || "visionbank-worker-webex-dashboard-reporting.js";
const aarOverridePath = process.argv[5] || "webex-daily-report-aar-override.js";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(sourcePath)) fail(`Production v5 Worker source not found: ${sourcePath}`);
if (!fs.existsSync(patchPath)) fail(`Reporting patch not found: ${patchPath}`);
if (!fs.existsSync(aarOverridePath)) fail(`AAR reporting adapter not found: ${aarOverridePath}`);

const source = fs.readFileSync(sourcePath, "utf8");
const patch = fs.readFileSync(patchPath, "utf8");
const aarOverride = fs.readFileSync(aarOverridePath, "utf8");

const requiredSourceAnchors = [
  'const WEBEX_DASHBOARD_BUILD = "2026.08.27-v5";',
  'const WEBEX_AGENT_CONTROL_BUILD = "2026.08.27-v5";',
  'if (path === "/api/webex/agent/auto-logout/run" && method === "POST")',
  'async function runWebexAutoLogoutSchedule(',
  'async function runWebexAgentReminderSchedule(',
  '["webex-agent-auto-logout", () => runWebexAutoLogoutSchedule(env)]',
  '["webex-agent-reminder", () => runWebexAgentReminderSchedule(env)]',
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
    fail(`Expected v5 production anchor missing: ${anchor}`);
  }
}

if (source.includes('const WEBEX_DASHBOARD_BUILD = "2026.08.27-v4";')) {
  fail("v4 Worker detected. Refusing to build because this would roll back Webex Agent controls.");
}

if (source.includes('/api/webex/daily-reports')) {
  fail("Source Worker already contains /api/webex/daily-reports; refusing duplicate integration.");
}

const routeAnchor = `if (path === "/api/webex/statistics" && method === "GET") {\n  return handleWebexStatistics(request, env, cors);\n}`;

if (!source.includes(routeAnchor)) {
  fail("Could not find the exact Webex statistics route anchor. No output was written.");
}

const routeAddition = `${routeAnchor}\n\n/** WEBEX DAILY CALL REPORTS - READ ONLY **/\nif (path === "/api/webex/daily-reports" && method === "GET") {\n  return handleWebexDailyReports(request, env, cors);\n}`;

const requiredPatchAnchors = [
  "async function handleWebexDailyReports(",
  "buildWebexDailyReportPayload",
  "fetchWebexDailyReportTasks",
  "fetchWebexDailyReportLegs",
  "fetchWebexDailyReportCarTasks",
  "WEBEX_DAILY_REPORT_CACHE_MS"
];

for (const anchor of requiredPatchAnchors) {
  if (!patch.includes(anchor)) fail(`Reporting patch anchor missing: ${anchor}`);
}

const requiredAarAnchors = [
  "fetchWebexDailyReportAgentSessions",
  "buildWebexDailyAarIndex",
  "enrichWebexCarTasksWithAar",
  'webexReportLower(activity?.state) === "connected"',
  'correlationKey: "task.id = taskLeg.taskId = carTask.id = aar.taskId"',
  "buildWebexDailyReportData = async function buildWebexDailyReportDataWithAar"
];

for (const anchor of requiredAarAnchors) {
  if (!aarOverride.includes(anchor)) fail(`AAR adapter anchor missing: ${anchor}`);
}

// The patch artifact ends with a documentation-only ROUTE ADDITION example.
// The builder inserts the real route above, so that trailing example must not be
// copied into the deployable Worker or counted as a second live route.
const routeDocumentationMarker = "/*******************************************************************************************\n * ROUTE ADDITION";
const routeDocumentationIndex = patch.indexOf(routeDocumentationMarker);
const executablePatch = routeDocumentationIndex >= 0
  ? patch.slice(0, routeDocumentationIndex).trimEnd()
  : patch.trimEnd();

if (executablePatch.includes('if (path === "/api/webex/daily-reports" && method === "GET")')) {
  fail("Executable reporting patch unexpectedly contains a daily-report route; refusing duplicate integration.");
}

let integrated = source.replace(routeAnchor, routeAddition);

integrated += `\n\n/* ============================================================\n   BEGIN WEBEX DAILY REPORTING EXTENSION\n   Source: ${path.basename(patchPath)}\n   Baseline: combined VisionBank Security v5 Worker\n   Integrated by build-visionbank-security-reporting.mjs\n   ============================================================ */\n\n${executablePatch}\n\n/* END WEBEX DAILY REPORTING EXTENSION */\n`;

integrated += `\n\n/* ============================================================\n   BEGIN WEBEX DAILY REPORTING AAR ADAPTER\n   Source: ${path.basename(aarOverridePath)}\n   Purpose: authoritative agent Connected/taskId enrichment\n   ============================================================ */\n\n${aarOverride.trimEnd()}\n\n/* END WEBEX DAILY REPORTING AAR ADAPTER */\n`;

const exactCountChecks = [
  ['async function handleWebexDailyReports(', 1],
  ['const WEBEX_DAILY_REPORT_CACHE_MS', 1],
  ['const WEBEX_DASHBOARD_BUILD = "2026.08.27-v5";', 1],
  ['const WEBEX_AGENT_CONTROL_BUILD = "2026.08.27-v5";', 1],
  ['async function runWebexAutoLogoutSchedule(', 1],
  ['async function runWebexAgentReminderSchedule(', 1],
  ['async function fetchWebexDailyReportAgentSessions(', 1],
  ['function buildWebexDailyAarIndex(', 1],
  ['function enrichWebexCarTasksWithAar(', 1]
];

for (const [needle, expected] of exactCountChecks) {
  const count = integrated.split(needle).length - 1;
  if (count !== expected) fail(`Integrated output expected ${expected} occurrence(s) of '${needle}', found ${count}.`);
}

const routeCount = integrated.split('if (path === "/api/webex/daily-reports" && method === "GET")').length - 1;
if (routeCount !== 1) fail(`Expected exactly one live daily-report route, found ${routeCount}.`);

const requiredPreservationChecks = [
  'WEBEX_TOKEN_URL',
  'WEBEX_REFRESH_EARLY_MS',
  '/api/webex/agent/settings',
  '/api/webex/agent/logout',
  '/api/webex/agent/auto-logout/run',
  'runWebexAutoLogoutSchedule',
  'runWebexAgentReminderSchedule',
  '/security/check',
  '/api/login',
  'aarConnectedRows',
  'task.id = taskLeg.taskId = carTask.id = aar.taskId'
];

for (const needle of requiredPreservationChecks) {
  if (!integrated.includes(needle)) fail(`Preservation check failed: ${needle}`);
}

fs.writeFileSync(outputPath, integrated, "utf8");

console.log("VisionBank Security v5 reporting candidate created successfully.");
console.log(`Source: ${sourcePath}`);
console.log(`Patch:  ${patchPath}`);
console.log(`AAR:    ${aarOverridePath}`);
console.log(`Output: ${outputPath}`);
console.log(`Bytes:  ${Buffer.byteLength(integrated, "utf8")}`);
console.log("Preserved: Webex OAuth rotation, Webex Agent controls, reminder scheduler, automatic sign-out scheduler.");
console.log("Reporting: CSR + CLR + CAR + AAR taskId correlation enabled.");
console.log("No Cloudflare deployment was performed by this script.");
