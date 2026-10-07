import test from 'node:test';
import assert from 'node:assert/strict';
import {patchDeviceFleetRoute,DEVICE_MANAGEMENT_ROUTE_ANCHOR,DEVICE_MANAGEMENT_FLEET_ROUTE,DEVICE_MANAGEMENT_FLEET_ROUTE_LEGACY} from '../../scripts/patch-device-fleet-route-r1.mjs';

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
