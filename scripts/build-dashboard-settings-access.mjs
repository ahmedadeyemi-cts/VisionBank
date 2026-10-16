// Restore network/business-hours access for shared dashboard preferences only.
// Apply to a freshly downloaded deployed Worker, never the legacy worker.js.
export function build(source) {
  const before = 'if (path === "/api/webex/dashboard/settings/save" && method === "POST") return { roles: operators };';
  const after = 'if (path === "/api/webex/dashboard/settings/save" && method === "POST") return { roles: operators, session: false };';
  if (source.split(before).length !== 2) throw new Error('Expected exactly one dashboard settings access rule');
  const candidate = source.replace(before, after);
  if (candidate.replace(after, before) !== source) throw new Error('Unexpected source change');
  return candidate;
}
