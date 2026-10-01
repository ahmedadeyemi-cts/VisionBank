// Machine-to-machine, read-only policy for the new Webex flow. Never authorizes a browser.
const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const output=(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function equal(a,b){
 const encode=x=>new TextEncoder().encode(x),hash=x=>crypto.subtle.digest('SHA-256',encode(x));
 const [x,y]=await Promise.all([hash(a),hash(b)]);let mismatch=0;const A=new Uint8Array(x),B=new Uint8Array(y);for(let i=0;i<A.length;i++)mismatch|=A[i]^B[i];return mismatch===0;
}
export async function handleFlowPolicy(request,env){
 if(request.method!=='POST')return output({success:false,error:'method-not-allowed'},405);
 const secret=env.CALLBACK_FLOW_POLICY_TOKEN;
 if(typeof secret!=='string'||secret.length<40)return output({success:false,error:'flow-policy-not-configured'},503);
 const auth=request.headers.get('Authorization')||'';
 if(auth.length>512||!await equal(auth,'Bearer '+secret))return output({success:false,error:'unauthorized'},401);
 if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return output({success:false,error:'json-required'},415);
 let body;try{
  const reader=request.body?.getReader();if(!reader)throw Error();let size=0,text='';const decoder=new TextDecoder();
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();throw Error();}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  body=JSON.parse(text);if(!body||Object.keys(body).some(k=>k!=='sourceInteraction')||!ID.test(body.sourceInteraction||''))throw Error();
 }catch{return output({success:false,error:'invalid-flow-policy-request'},400);}
 const org=String(env.WEBEX_ORG_ID||''),store=env.ABANDONED_CALLBACK_SETTINGS;
 if(!org||!store?.idFromName)return output({success:false,error:'flow-policy-store-unavailable'},503);
 let timer;try{
  const response=await Promise.race([store.get(store.idFromName(org+':settings:v1')).fetch(new Request('https://callback-settings.internal/flow-policy?id='+body.sourceInteraction.toLowerCase())),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('deadline')),8000);})]);
  return output(await response.json(),response.status);
 }catch{return output({success:false,error:'flow-policy-unavailable'},503);}finally{clearTimeout(timer);}
}
export function storedFlowPolicy(record,now=Date.now()){
 if(!record?.scheduleId||!ID.test(record.scheduleId)||!Number.isInteger(record.policy?.totalAttempts)||record.policy.totalAttempts<1||record.policy.totalAttempts>10||!Number.isFinite(record.window?.startEpoch)||!Number.isFinite(record.window?.endEpoch))return {success:false,allowed:false,error:'confirmed-callback-policy-not-found'};
 const blocked=['canceled','completed','exhausted','expired','failed-terminal','not-submitted','rejected'].includes(record.status);
 const inWindow=now>=record.window.startEpoch&&now<record.window.endEpoch;
 return {success:true,allowed:!blocked&&inWindow&&!record.management,sourceInteraction:record.contactId,scheduleId:record.scheduleId,totalAttempts:record.policy.totalAttempts,
   attemptsAlreadyReported:record.attemptsMade??null,windowStartEpoch:record.window.startEpoch,windowEndEpoch:record.window.endEpoch,timezone:'America/Chicago',
   reason:record.payload.callbackReason,settingsVersion:record.settingsVersion,
   restriction:blocked?'callback-already-terminal':!inWindow?'outside-original-callback-window':record.management?'schedule-change-pending':null};
}
