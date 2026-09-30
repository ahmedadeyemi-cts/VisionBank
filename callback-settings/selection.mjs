import { SettingsError, AGENT_MESSAGE, normalizeSettings } from './policy.mjs';
// Read-only planning. This module cannot create a native callback or dial a customer.
export const MAX_SELECTION = 1000;
const CONTACT_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail = (ok, code) => { if (!ok) throw new SettingsError(code); };
export const centralDate = at => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(at));
const centralTime = at => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).format(new Date(at));
const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const clock = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export function callbackNumber(value) {
  const raw = String(value ?? '').trim();
  if (!/^[+\d() .-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+1') && !/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  if (/^\+[1-9]\d{7,14}$/.test(raw.replace(/[() .-]/g, ''))) return '+' + digits;
  if (/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return '+1' + digits;
  if (/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return '+' + digits;
  return null;
}
export function localEpoch(date, time) {
  fail(/^20\d{2}-\d{2}-\d{2}$/.test(date) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time), 'invalid-callback-time');
  const utc = Date.parse(date + 'T' + time + ':00Z');
  fail(Number.isFinite(utc) && new Date(utc).toISOString().slice(0, 10) === date, 'invalid-callback-date');
  const matches = [5, 6].map(h => utc + h * 3600000).filter(at => centralDate(at) === date && centralTime(at) === time);
  fail(matches.length === 1, 'ambiguous-or-nonexistent-central-time');
  return matches[0];
}
export function validateWindow(date, time, settings, now = Date.now()) {
  const s = normalizeSettings(settings), start = localEpoch(date, time);
  const endMinutes = minutes(time) + s.windowMinutes;
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  fail(s.days.includes(weekday) && !s.excludedDates.includes(date), 'outside-callback-days');
  fail(time >= s.startTime && endMinutes <= minutes(s.endTime), 'outside-callback-hours');
  fail(start >= now + s.delayMinutes * 60000 && start <= now + 31 * 86400000, 'outside-scheduling-horizon');
  const endTime = clock(endMinutes), end = localEpoch(date, endTime);
  return {date, startTime: time, endTime, startEpoch: start, endEpoch: end, timezone: s.timezone};
}
export function nextWindow(settings, now = Date.now()) {
  const s = normalizeSettings(settings), first = Math.ceil((now + s.delayMinutes * 60000) / 60000) * 60000;
  const firstDate = centralDate(first), firstMinute = minutes(centralTime(first));
  const dateBase = Date.parse(firstDate + 'T12:00:00Z');
  for (let day = 0; day <= 31; day++) {
    const date = new Date(dateBase + day * 86400000).toISOString().slice(0, 10);
    if (!s.days.includes(new Date(date + 'T12:00:00Z').getUTCDay()) || s.excludedDates.includes(date)) continue;
    const start = Math.max(minutes(s.startTime), day === 0 ? firstMinute : 0);
    for (let minute = start; minute + s.windowMinutes <= minutes(s.endTime); minute++) {
      try { return validateWindow(date, clock(minute), s, now); } catch { /* DST or horizon boundary */ }
    }
  }
  throw new SettingsError('no-callback-window-within-31-days');
}
export function parseSelection(body) {
  fail(body && typeof body === 'object' && !Array.isArray(body), 'invalid-selection');
  fail(Object.keys(body).every(k => ['contactIds','scope','expectedVersion','date','startTime'].includes(k)), 'unknown-selection-field');
  fail(['selected','all-matching'].includes(body.scope), 'invalid-selection-scope');
  fail(Array.isArray(body.contactIds) && body.contactIds.length > 0 && body.contactIds.length <= MAX_SELECTION, 'selection-limit');
  fail(body.contactIds.every(id => typeof id === 'string' && CONTACT_ID.test(id)), 'invalid-contact-id');
  const ids = body.contactIds.map(id => id.toLowerCase());
  fail(new Set(ids).size === ids.length, 'duplicate-selected-id');
  fail(Number.isSafeInteger(body.expectedVersion) && body.expectedVersion >= 0, 'invalid-version');
  return {...body, contactIds: ids};
}
export function buildPreview(body, state, report, queueOptions, now = Date.now()) {
  const selection = parseSelection(body), s = normalizeSettings(state.settings);
  fail(selection.expectedVersion === state.version, 'settings-changed-reload');
  fail(s.queueId && queueOptions.some(q => q.id === s.queueId), 'voice-queue-not-configured');
  fail(report?.success === true && Array.isArray(report.abandonedCalls), 'abandoned-report-unavailable');
  const observed = report.generatedAtEpoch;
  fail(Number.isFinite(observed) && observed <= now + 5000 && now - observed <= 180000 &&
    centralDate(observed) === centralDate(now), 'abandoned-report-stale');
  const window = validateWindow(selection.date, selection.startTime, s, now);
  const map = new Map(report.abandonedCalls.map(r => [String(r.contactId).toLowerCase(), r]));
  const seenNumbers = new Set(), rows = [], ids = [...selection.contactIds];
  ids.sort((a, b) => (map.get(b)?.startEpoch || 0) - (map.get(a)?.startEpoch || 0));
  for (const contactId of ids) {
    const row = map.get(contactId), number = callbackNumber(row?.ani);
    let reason = null;
    if (!row || !Number.isFinite(row.startEpoch) || centralDate(row.startEpoch) !== centralDate(now)) reason = 'not-in-todays-abandoned-report';
    else if (!Number.isFinite(row.endEpoch) || row.endEpoch <= 0 || row.endEpoch > now || row.endEpoch < row.startEpoch) reason = 'call-not-confirmed-ended';
    else if (row.isContactHandled === true || row.isActive === true) reason = 'no-longer-abandoned';
    else if (row.callbackScheduleId || Number(row.callbackAttempts) > 0) reason = 'callback-already-recorded';
    else if (!number) reason = 'invalid-or-withheld-number';
    else if (seenNumbers.has(number)) reason = 'same-number-already-in-batch';
    if (!reason) seenNumbers.add(number);
    rows.push({contactId, number: row ? number : null, disposition: reason ? 'skipped' : 'candidate', reason,
      callbackStatus: row?.callbackScheduleId ? 'Previously scheduled' : 'Not verified', scheduleId: row?.callbackScheduleId || null});
  }
  const candidates = rows.filter(r => r.disposition === 'candidate').length;
  return {success: true, previewOnly: true, canSchedule: false, executionCode: 'callback-execution-not-connected',
    settingsEnabled: s.enabled, settingsVersion: state.version, observedAt: now, reportObservedAt: observed,
    scope: selection.scope, selected: ids.length, candidates, skipped: ids.length - candidates, rows, window,
    queue: queueOptions.find(q => q.id === s.queueId), agentMessage: AGENT_MESSAGE, maxAttempts: s.maxAttempts,
    warning: 'Preview only. Native callback inventory, routing and retry-policy execution are not connected. No calls or schedules were created.'};
}
