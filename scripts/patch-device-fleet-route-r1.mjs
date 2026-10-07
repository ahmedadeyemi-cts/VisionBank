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
