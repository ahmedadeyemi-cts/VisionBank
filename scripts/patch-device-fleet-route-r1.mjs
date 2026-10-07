export const DEVICE_MANAGEMENT_ROUTE_ANCHOR =
`if (path.startsWith("/api/webex/device-management/")) {
  return vbDeviceManagement(request, env, cors);
}`;

export const DEVICE_MANAGEMENT_FLEET_ROUTE_LEGACY =
`if (path.startsWith("/api/webex/device-management/") || path.startsWith("/x/")) {
  return vbDeviceManagement(request, env, cors);
}`;

export const DEVICE_MANAGEMENT_FLEET_ROUTE =
`if (path.startsWith("/api/webex/device-management/") || path.startsWith("/x/")) {
  return vbDeviceManagement(request, env, cors, ctx);
}`;

export function patchDeviceFleetRoute(source){
  const text=String(source??'');
  if(text.includes(DEVICE_MANAGEMENT_FLEET_ROUTE))return text;
  if(text.includes(DEVICE_MANAGEMENT_FLEET_ROUTE_LEGACY))return text.replace(DEVICE_MANAGEMENT_FLEET_ROUTE_LEGACY,DEVICE_MANAGEMENT_FLEET_ROUTE);
  if(text.includes('path.startsWith("/x/")'))throw new Error('unexpected-existing-fleet-route');
  const count=text.split(DEVICE_MANAGEMENT_ROUTE_ANCHOR).length-1;
  if(count!==1)throw new Error('device-management-route-anchor-count:'+count);
  return text.replace(DEVICE_MANAGEMENT_ROUTE_ANCHOR,DEVICE_MANAGEMENT_FLEET_ROUTE);
}


export const WORKER_FETCH_SIGNATURE_LEGACY='async fetch(request, env) {';
export const WORKER_FETCH_SIGNATURE_CONTEXT='async fetch(request, env, ctx) {';

export function patchDeviceFleetRuntime(source){
  let text=String(source??'');
  const hasLegacyFetch=text.includes(WORKER_FETCH_SIGNATURE_LEGACY);
  const hasContextFetch=text.includes(WORKER_FETCH_SIGNATURE_CONTEXT);
  if(hasLegacyFetch&&hasContextFetch)throw new Error('worker-fetch-signature-ambiguous');
  if(hasLegacyFetch){
    const count=text.split(WORKER_FETCH_SIGNATURE_LEGACY).length-1;
    if(count!==1)throw new Error('worker-fetch-signature-count:'+count);
    text=text.replace(WORKER_FETCH_SIGNATURE_LEGACY,WORKER_FETCH_SIGNATURE_CONTEXT);
  }else if(!hasContextFetch){
    throw new Error('worker-fetch-signature-count:0');
  }
  text=patchDeviceFleetRoute(text);
  if(!text.includes(WORKER_FETCH_SIGNATURE_CONTEXT))throw new Error('worker-fetch-context-missing');
  if(!text.includes(DEVICE_MANAGEMENT_FLEET_ROUTE))throw new Error('device-management-context-route-missing');
  return text;
}
