import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhonismReader} from '../../device-management/phonism.mjs';

const wrap=(data,next=null)=>Response.json({data,errors:[],messages:[],result_count:Array.isArray(data)?data.length:1,total_count:2,next,previous:null});

test('Phonism pagination strips the /api/v3 prefix from absolute next links',async()=>{
  const calls=[];
  const fetcher=async(_env,path)=>{
    calls.push(path);
    if(path==='/hierarchy/40/phones?limit=100'){
      return wrap([{id:1,tenant_id:10,company_id:40,mac_address:'001122334455'}],
        'https://app.phonism.com/api/v3/hierarchy/40/phones?limit=100&start_after_id=1');
    }
    if(path==='/hierarchy/40/phones?limit=100&start_after_id=1'){
      return wrap([{id:2,tenant_id:10,company_id:40,mac_address:'001122334466'}]);
    }
    throw new Error('unexpected path '+path);
  };
  const reader=createPhonismReader({fetcher});
  const result=await reader.phones({},'40',[{id:'10',name:'DUFF'}]);
  assert.equal(result.phones.length,2);
  assert.deepEqual(calls,[
    '/hierarchy/40/phones?limit=100',
    '/hierarchy/40/phones?limit=100&start_after_id=1'
  ]);
});
