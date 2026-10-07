import test from 'node:test';
import assert from 'node:assert/strict';
import {patchDeviceFleetRoute,patchDeviceFleetRuntime,DEVICE_MANAGEMENT_ROUTE_ANCHOR,DEVICE_MANAGEMENT_FLEET_ROUTE,DEVICE_MANAGEMENT_FLEET_ROUTE_LEGACY,WORKER_FETCH_SIGNATURE_LEGACY,WORKER_FETCH_SIGNATURE_CONTEXT} from '../../scripts/patch-device-fleet-route-r1.mjs';

test('fleet release widens only the existing Device Management route to /x/',()=>{
  const source='before\n'+DEVICE_MANAGEMENT_ROUTE_ANCHOR+'\nafter';
  const patched=patchDeviceFleetRoute(source);
  assert.equal(patched,'before\n'+DEVICE_MANAGEMENT_FLEET_ROUTE+'\nafter');
  assert.equal((patched.match(/path\.startsWith\("\/x\/"\)/g)||[]).length,1);
});

test('fleet route patch refuses missing or duplicate route anchors',()=>{
  assert.throws(()=>patchDeviceFleetRoute('no device route'),/anchor-count:0/);
  assert.throws(()=>patchDeviceFleetRoute(DEVICE_MANAGEMENT_ROUTE_ANCHOR+'\n'+DEVICE_MANAGEMENT_ROUTE_ANCHOR),/anchor-count:2/);
});

test('fleet route patch is idempotent only for the reviewed route',()=>{
  assert.equal(patchDeviceFleetRoute(DEVICE_MANAGEMENT_FLEET_ROUTE),DEVICE_MANAGEMENT_FLEET_ROUTE);
  assert.throws(()=>patchDeviceFleetRoute('if (path.startsWith("/x/")) return other();'),/unexpected-existing-fleet-route/);
});


test('existing fleet route is upgraded to pass Cloudflare execution context',()=>{
  const patched=patchDeviceFleetRoute(DEVICE_MANAGEMENT_FLEET_ROUTE_LEGACY);
  assert.equal(patched,DEVICE_MANAGEMENT_FLEET_ROUTE);
  assert.match(patched,/vbDeviceManagement\(request, env, cors, ctx\)/);
});


test('runtime patch defines fetch ctx before passing it to Device Management',()=>{
  const source=[
    'export default {',
    '  '+WORKER_FETCH_SIGNATURE_LEGACY,
    '    const cors={};',
    DEVICE_MANAGEMENT_FLEET_ROUTE_LEGACY,
    '  }',
    '};'
  ].join('\n');
  const patched=patchDeviceFleetRuntime(source);
  assert.match(patched,/async fetch\(request, env, ctx\) \{/);
  assert.match(patched,/vbDeviceManagement\(request, env, cors, ctx\)/);
  assert.doesNotMatch(patched,/async fetch\(request, env\) \{/);
});

test('runtime patch is idempotent when fetch context and route are already present',()=>{
  const source=[
    'export default {',
    '  '+WORKER_FETCH_SIGNATURE_CONTEXT,
    '    const cors={};',
    DEVICE_MANAGEMENT_FLEET_ROUTE,
    '  }',
    '};'
  ].join('\n');
  assert.equal(patchDeviceFleetRuntime(source),source);
});

test('runtime patch fails closed if ctx route is requested without a recognizable fetch signature',()=>{
  assert.throws(
    ()=>patchDeviceFleetRuntime('before\n'+DEVICE_MANAGEMENT_FLEET_ROUTE_LEGACY+'\nafter'),
    /worker-fetch-signature-count:0/
  );
});
