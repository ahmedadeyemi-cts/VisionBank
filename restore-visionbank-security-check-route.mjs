import fs from "node:fs";

const target = process.argv[2] || "visionbank-worker-webex-agent-v5.js";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(target)) {
  fail(`Combined VisionBank Security v5 source not found: ${target}`);
}

let source = fs.readFileSync(target, "utf8");

const securityRouteNeedle = 'if (path === "/security/check" && method === "GET")';
const statisticsRoute = `if (path === "/api/webex/statistics" && method === "GET") {\n  return handleWebexStatistics(request, env, cors);\n}`;

if (!source.includes("async function checkAccess(")) {
  fail("checkAccess() is missing from the combined Worker; refusing to modify the file.");
}

if (!source.includes("function json(")) {
  fail("json() response helper is missing from the combined Worker; refusing to modify the file.");
}

const existingRouteCount = source.split(securityRouteNeedle).length - 1;
if (existingRouteCount === 1) {
  console.log("Security check route already present exactly once. No source change needed.");
  process.exit(0);
}

if (existingRouteCount > 1) {
  fail(`Found ${existingRouteCount} security check routes; refusing to create another one.`);
}

if (!source.includes(statisticsRoute)) {
  fail("Could not find the Webex statistics route anchor; refusing to modify the Worker.");
}

const securityRoute = `/** VISIONBANK SHARED SECURITY PRE-CHECK - REQUIRED BY ALL DASHBOARDS **/\nif (path === "/security/check" && method === "GET") {\n  const access = await checkAccess(request, env);\n  return json(access, cors);\n}`;

source = source.replace(statisticsRoute, `${securityRoute}\n\n${statisticsRoute}`);

const finalRouteCount = source.split(securityRouteNeedle).length - 1;
if (finalRouteCount !== 1) {
  fail(`Expected exactly one security check route after repair, found ${finalRouteCount}.`);
}

fs.writeFileSync(target, source, "utf8");

console.log(`Restored GET /security/check in ${target}.`);
console.log("The route reuses the existing checkAccess() IP/business-hours policy and json() response helper.");
console.log("No security policy, CORS policy, OAuth logic, report logic, or scheduled task logic was changed.");
