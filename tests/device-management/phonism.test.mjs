import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhonismReader,defaultPhonismFetch,PHONISM_BASE} from '../../device-management/phonism.mjs';

const ok=data=>Response.json({data,errors:[],messages:[],result_count:Array.isArray(data)?data.length:1,total_count:Array.isArray(data)?data.length:1,next:null,previous:null});

function fixture(){
  const calls=[];
  const fetcher=async(_env,path,options={})=>{
    calls.push({path,method:options.method||'GET'});
    if(path.startsWith('/hierarchy/?'))return ok([
      {id:10,name:'US Signal',type:'Account',children:[
        {id:20,name:'US Signal',type:'Service Provider',children:[
          {id:30,name:'US Signal',type:'Enterprise',children:[
            {id:40,name:'VisionBank Iowa',type:'Domain',metadata:{webex_organization_id:'org-1'}}
          ]}
        ]}
      ]}
    ]);
    if(path.startsWith('/hierarchy/40/tenants/'))return ok([
      {id:101,company_id:40,name:'DUFF',metadata:[{name:'webex_location_id',value:'loc-a'}]},
      {id:102,company_id:40,name:'CLIVE',metadata:[{name:'webex_location_id',value:'loc-b'}]}
    ]);
    if(path.startsWith('/hierarchy/40/integrations'))return ok([
      {id:501,company_id:40,type:'Webex',name:'Webex',last_connected_at:'2026-10-01 12:00:00'}
    ]);
    if(path.startsWith('/hierarchy/40/phones'))return ok([
      {id:9001,tenant_id:101,company_id:40,mac_address:'001122334455',state:1,
        service_state:['tr069'],last_provision:'2026-10-01 12:10:00',
        metadata:[{name:'webex_device_id',value:'webex-1'},{name:'webex_device_type',value:'CALLING_DEVICE'}]}
    ]);
    if(path==='/phones/9001/lines')return ok([
      {line_number:1,voip_credential_id:33,username:'sip-user-1',alias:'Alex User',registration_status:'registered'},
      {line_number:2,voip_credential_id:34,username:'sip-user-2',alias:'Open Desk',registration_status:'unregistered'}
    ]);
    return Response.json({data:null,errors:['not found'],messages:[]},{status:404});
  };
  return {reader:createPhonismReader({fetcher}),calls};
}

test('discovers VisionBank Iowa and Webex tenant metadata',async()=>{
  const {reader,calls}=fixture();
  const d=await reader.discover({},'org-1');
  assert.equal(d.domain.id,'40');
  assert.equal(d.domain.name,'VisionBank Iowa');
  assert.equal(d.tenants.length,2);
  assert.equal(d.tenants[0].webexLocationId,'loc-a');
  assert.equal(d.webexIntegration.id,'501');
  assert.ok(calls.every(c=>c.method==='GET'));
});

test('normalizes Phonism phone metadata, MAC and TR-069 state',async()=>{
  const {reader}=fixture();
  const d=await reader.discover({},'org-1');
  const inventory=await reader.phones({},d.domain.id,d.tenants);
  assert.equal(inventory.phones.length,1);
  const p=inventory.phones[0];
  assert.equal(p.mac,'00:11:22:33:44:55');
  assert.equal(p.tenantName,'DUFF');
  assert.equal(p.webexDeviceId,'webex-1');
  assert.equal(p.tr069,true);
  assert.equal(p.lastProvision,'2026-10-01 12:10:00');
});

test('reads independent Phonism line registration status',async()=>{
  const {reader}=fixture();
  const lines=await reader.lines({},'9001');
  assert.equal(lines[0].lineNumber,1);
  assert.equal(lines[0].registrationStatus,'registered');
  assert.equal(lines[1].lineNumber,2);
  assert.equal(lines[1].registrationStatus,'unregistered');
});

test('default client refuses writes before any network request',async()=>{
  await assert.rejects(
    ()=>defaultPhonismFetch({PHONISM_API_KEY:'x'.repeat(32)},'/phones/1',{method:'PUT'}),
    error=>error.code==='phonism-read-only'&&error.status===405
  );
});

test('default client requires the server-side API key',async()=>{
  await assert.rejects(
    ()=>defaultPhonismFetch({},'/phones/1',{method:'GET'}),
    error=>error.code==='phonism-api-key-not-configured'
  );
  assert.equal(PHONISM_BASE,'https://app.phonism.com/api/v3');
});
