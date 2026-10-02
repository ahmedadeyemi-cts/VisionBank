import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceManagementHandler} from '../../device-management/gateway.mjs';

const ORIGIN='https://visionbank-dashboard.onrender.com';

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}

test('inventory without location returns VisionBank summary phones instead of an empty list',async()=>{
  const phonismReader={
    async discover(){return {domain:{id:'40',name:'VisionBank Iowa'},tenants:[
      {id:'101',name:'DUFF',webexLocationId:'loc-a'},
      {id:'102',name:'CLIVE',webexLocationId:'loc-b'}
    ],webexIntegration:null,truncated:false};},
    async phones(){return {phones:[
      {id:'9001',tenantId:'101',tenantName:'DUFF',mac:'00:11:22:33:44:55',alias:'Test User',state:'1',tr069:true,serviceState:['tr069'],webexDeviceId:'webex-1',webexDeviceType:'Partner Managed Phone - Yealink'},
      {id:'9002',tenantId:'102',tenantName:'CLIVE',mac:'00:11:22:33:44:66',alias:'Open Workspace',state:'1',tr069:true,serviceState:['tr069'],webexDeviceId:'webex-2',webexDeviceType:'Partner Managed Phone - Yealink'}
    ],truncated:false};}
  };
  const webexFetch=async(_env,url)=>{
    const u=new URL(url);
    if(u.pathname==='/v1/locations')return json({items:[{id:'loc-a',name:'DUFF'},{id:'loc-b',name:'CLIVE'}]});
    return json({},404);
  };
  const handler=createDeviceManagementHandler({webexFetch,checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],phonismReader});
  const req=new Request('https://worker.example/api/webex/device-management/inventory',{
    headers:{Origin:ORIGIN,'CF-Connecting-IP':'198.51.100.12'}
  });
  Object.defineProperty(req,'cf',{value:{colo:'TEST'}});
  const res=await handler(req,{WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32)},{});
  const data=await res.json();
  assert.equal(res.status,200);
  assert.equal(data.summaryOnly,true);
  assert.equal(data.devices.length,2);
  assert.equal(data.devices[0].detailsLoaded,false);
  assert.equal(data.devices[0].locationName,'DUFF');
  assert.equal(data.devices[1].locationName,'CLIVE');
});
