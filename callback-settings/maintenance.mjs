// Internal scheduled work only. No public activation or customer-dial endpoint.
export function createCallbackMaintenance({getAbandonedReport}){
  return async env=>{
    try{
      const org=String(env.WEBEX_ORG_ID||''),namespace=env.ABANDONED_CALLBACK_SETTINGS;
      if(!org||!namespace?.idFromName)return;
      const store=namespace.get(namespace.idFromName(org+':settings:v1'));
      const response=await store.fetch(new Request('https://callback-settings.internal/automation-status'));
      if(!response.ok)return;const status=await response.json();if(status.eligible!==true)return;
      const report=await getAbandonedReport(env);
      const result=await store.fetch(new Request('https://callback-settings.internal/automation-tick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report})}));
      console.log(JSON.stringify({event:'vb-callback-automatic-scan',http:result.status}));
    }catch{console.log(JSON.stringify({event:'vb-callback-automatic-scan',error:'scan-unavailable'}));}
  };
}
