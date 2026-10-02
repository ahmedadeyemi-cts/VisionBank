import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPhonismReader} from '../../device-management/phonism.mjs';

test('Phonism line without registration_status is explicitly not monitored',async()=>{
  const fetcher=async()=>Response.json({
    data:[{line_number:1,voip_credential_id:33,username:'sip-user',alias:'Test User'}],
    errors:[],messages:[],next:null,previous:null
  });
  const reader=createPhonismReader({fetcher});
  const lines=await reader.lines({},'313135');
  assert.equal(lines.length,1);
  assert.equal(lines[0].registrationStatus,'not-monitored');
  assert.equal(lines[0].registrationMonitored,false);
});

test('production worker CORS allows the device operator session header',()=>{
  const source=fs.readFileSync(new URL('../../worker.js',import.meta.url),'utf8');
  const match=source.match(/Access-Control-Allow-Headers["']?\s*:\s*["']([^"']+)/);
  assert.ok(match,'CORS allow-header declaration should exist');
  assert.match(match[1],/X-VB-Operator-Session/i);
});
