import {DeviceManagementError,normalizeMac} from './contracts.mjs';

const WEBEX='https://webexapis.com/v1';
const mac=value=>{try{return normalizeMac(value);}catch{return null;}};
const organizationId=value=>{
  const text=String(value||'');
  try{const decoded=atob(text);const match=decoded.match(/^ciscospark:\/\/[^/]+\/ORGANIZATION\/([0-9a-f-]{36})$/i);if(match)return match[1].toLowerCase();}catch{}
  return text.toLowerCase();
};
const failure=code=>new DeviceManagementError(code,503);

// Enrollment and inventory can carry different Webex IDs. Revalidate the
// expected device directly, then try inventory aliases; never trust an ID alone.
export async function resolveVerifiedWriteDevice({webexFetch,env,phone,deviceId,locationId,org,timeoutMs=12000}){
  const ids=[...new Set([deviceId,...(phone.webexDeviceIds||[]),phone.webexDeviceId].filter(Boolean))];
  let lastError=null;
  for(const candidate of ids){
    let data=null;
    for(let attempt=0;attempt<2;attempt++){
      let timer;
      const controller=new AbortController();
      try{
        data=await Promise.race([(async()=>{
          const response=await webexFetch(env,WEBEX+'/devices/'+encodeURIComponent(candidate),{method:'GET',signal:controller.signal});
          if(response.status===404)return null;
          if(!response.ok){
            const code=response.status===401||response.status===403?'webex-device-authentication-failed':response.status===429?'webex-device-rate-limited':'webex-device-lookup-unavailable';
            const error=failure(code);error.upstreamStatus=response.status;throw error;
          }
          try{return await response.json();}catch{throw failure('webex-device-response-invalid');}
        })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(failure('webex-device-lookup-timeout'));},timeoutMs);})]);
        break;
      }catch(error){
        lastError=error?.code?error:failure('webex-device-lookup-unavailable');
        if(['webex-device-authentication-failed','webex-device-rate-limited'].includes(lastError.code))throw lastError;
        if(attempt===1)break;
      }finally{clearTimeout(timer);}
    }
    if(!data)continue;
    if(String(data.callingDeviceId||data.id||'')!==String(deviceId||''))throw new DeviceManagementError('device-identity-mismatch',409);
    if(!mac(phone.mac)||mac(data.mac||data.macAddress)!==mac(phone.mac))throw new DeviceManagementError('device-mac-mismatch',409);
    if(String(data.locationId||'')!==String(locationId||''))throw new DeviceManagementError('device-location-mismatch',409);
    if(data.orgId&&organizationId(data.orgId)!==organizationId(org))throw new DeviceManagementError('device-organization-mismatch',409);
    return {data,matchedId:candidate};
  }
  if(lastError)throw lastError;
  throw new DeviceManagementError('webex-device-not-found',404);
}
