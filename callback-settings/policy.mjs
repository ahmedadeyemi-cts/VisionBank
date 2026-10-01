// Settings only: this module does not schedule, dial, retry or cancel calls.
export const REVISION = '2026.09.30-abandoned-callback-settings-v3';
export const AGENT_MESSAGE = 'Callback for missed call from customer';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export class SettingsError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const defaults = () => ({ enabled: false, mode: 'manual', queueId: '', callbackEntryPointId: '',
  delayMinutes: 30, windowMinutes: 30, timezone: 'America/Chicago',
  days: [1,2,3,4,5], startTime: '08:00', endTime: '17:00', excludedDates: [],
  maxAttempts: 3, assignment: 'any-available-agent', agentMessage: AGENT_MESSAGE });
export const initialState = () => ({ version: 0, settings: defaults(), updatedAt: null, lastChangedBy: null });
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const need = (ok, code) => { if (!ok) throw new SettingsError(code); };
export function normalizeSettings(value) {
  need(plain(value), 'invalid-settings');
  const allowed = Object.keys(defaults());
  need(Object.keys(value).every(k => allowed.includes(k)), 'unknown-setting');
  const s = { ...defaults(), ...value };
  need(typeof s.enabled === 'boolean', 'invalid-enabled');
  need(['manual','automatic-new-abandoned'].includes(s.mode), 'invalid-mode');
  need(typeof s.queueId === 'string' && (s.queueId === '' || ENTITY_ID.test(s.queueId)), 'invalid-queue');
  need(!s.enabled || s.queueId !== '', 'queue-required');
  need(typeof s.callbackEntryPointId === 'string' && (s.callbackEntryPointId === '' || ENTITY_ID.test(s.callbackEntryPointId)), 'invalid-callback-entry-point');
  need(Number.isInteger(s.delayMinutes) && s.delayMinutes >= 30 && s.delayMinutes <= 1440, 'invalid-delay');
  need(Number.isInteger(s.windowMinutes) && s.windowMinutes >= 30 && s.windowMinutes <= 480, 'invalid-window');
  need(s.timezone === 'America/Chicago', 'invalid-timezone');
  need(Number.isInteger(s.maxAttempts) && s.maxAttempts >= 1 && s.maxAttempts <= 10, 'invalid-max-attempts');
  need(s.assignment === 'any-available-agent' && s.agentMessage === AGENT_MESSAGE, 'fixed-callback-policy');
  need(Array.isArray(s.days) && s.days.length > 0 && s.days.length <= 7 &&
    s.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6) && new Set(s.days).size === s.days.length, 'invalid-days');
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  need(time.test(s.startTime) && time.test(s.endTime) && s.startTime < s.endTime, 'invalid-callback-hours');
  const minutes = t => Number(t.slice(0,2))*60 + Number(t.slice(3));
  need(minutes(s.endTime)-minutes(s.startTime) >= s.windowMinutes, 'window-exceeds-callback-hours');
  need(Array.isArray(s.excludedDates) && s.excludedDates.length <= 64 && s.excludedDates.every(d =>
    typeof d === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) &&
    new Date(d).toISOString().slice(0,10) === d), 'invalid-excluded-dates');
  return { ...s, days: [...s.days].sort(), excludedDates: [...new Set(s.excludedDates)].sort() };
}
export function parseMutation(body) {
  need(plain(body) && Object.keys(body).every(k => ['mutationId','expectedVersion','settings'].includes(k)), 'invalid-request');
  need(UUID.test(body.mutationId || ''), 'invalid-mutation-id');
  need(Number.isSafeInteger(body.expectedVersion) && body.expectedVersion >= 0, 'invalid-version');
  return { mutationId: body.mutationId, expectedVersion: body.expectedVersion, settings: normalizeSettings(body.settings) };
}
export function browserDetails(userAgent = '') {
  const ua = String(userAgent).slice(0,1024);
  const browser = /Edg\//.test(ua) ? 'Microsoft Edge' : /Firefox\//.test(ua) ? 'Firefox' :
    /(?:Chrome|CriOS)\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Not reported';
  const operatingSystem = /Windows NT/.test(ua) ? 'Windows' : /(?:iPhone|iPad)/.test(ua) ? 'iOS/iPadOS' :
    /Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Not reported';
  return { browser, operatingSystem, deviceEvidence: 'browser-reported', computerName: null, internalIp: null };
}
export const processingState = state => ({ state: state.settings.enabled ? 'enabled-paused' : 'disabled',
  ready: false, code: 'callback-execution-not-connected',
  message: 'Settings are saved. Native callback scheduling, routing and the configured retry policy still require validation. No calls are placed by this settings release.' });
