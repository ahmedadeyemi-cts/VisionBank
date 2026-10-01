/* Dashboard-only request lifecycle repair. Not a standalone Worker.
 * Cache completed JSON, never another request's promise, timer, stream or response.
 * Leases are plain data: canceled owners cannot leave permanent in-flight locks.
 * Existing security checks, reporting queries, calculations and TTL are retained.
 */
const VB_DASHBOARD_R8='2026.09.30-dashboard-r8';
const vbDashR8Cache=new Map();
let vbDashR8Sequence=0;
const VB_DASH_R8_TTL=5000, VB_DASH_R8_BUILD=37000, VB_DASH_R8_LEASE=39000, VB_DASH_R8_JOIN=3000;
function vbDashR8Log(phase,details={}) {
  console.log(JSON.stringify({event:'vb-dashboard-lifecycle',revision:VB_DASHBOARD_R8,phase,...details}));
}
function vbDashR8Result(data,result) {
  return {...data,dashboardLifecycleRevision:VB_DASHBOARD_R8,
    reportingDiagnostics:{...data.reportingDiagnostics,cacheMode:'completed-data-only',cacheResult:result}};
}
async function vbDashR8Build(env) {
  const now=Date.now(),org=String(env.WEBEX_ORG_ID||'');
  if(!org)throw vbRepError('report-organization-unavailable');
  const day=getCentralDayStartEpochMs(now),key=org+':dashboard:'+day;
  for(const [k,e] of vbDashR8Cache)if(e.expires<=now&&(!e.lease||e.lease.until<=now)&&k!==key)vbDashR8Cache.delete(k);
  let entry=vbDashR8Cache.get(key);
  if(!entry){entry={data:null,expires:0,lease:null};vbDashR8Cache.set(key,entry);}
  if(entry.data&&entry.expires>now){vbDashR8Log('cache-hit');return vbDashR8Result(entry.data,'hit');}
  if(entry.lease&&entry.lease.until<=now){
    vbDashR8Log('expired-owner-released',{ageMs:now-entry.lease.startedAt});entry.lease=null;
  }
  if(entry.lease){
    const token=entry.lease.token,deadline=Date.now()+VB_DASH_R8_JOIN;
    vbDashR8Log('wait-for-completed-data');
    while(entry.lease?.token===token&&Date.now()<deadline){
      // This timer belongs to THIS request, not the request doing the build.
      await new Promise(resolve=>setTimeout(resolve,Math.min(100,Math.max(1,deadline-Date.now()))));
    }
    if(entry.data&&entry.expires>Date.now())return vbDashR8Result(entry.data,'joined-completed-data');
    vbDashR8Log('bounded-wait-ended');
    throw vbRepError('dashboard-refresh-pending',503,5);
  }
  const lease={token:++vbDashR8Sequence,startedAt:Date.now(),until:Date.now()+VB_DASH_R8_LEASE};
  entry.lease=lease;vbDashR8Log('build-start');
  try{
    const data=await vbRepBound(Promise.resolve().then(()=>vbRepBuildUncached(env)),Date.now()+VB_DASH_R8_BUILD,'dashboard-build-deadline');
    if(data?.success!==true||!Array.isArray(data.queues)||!Array.isArray(data.agents)||!data.statistics)
      throw vbRepError('dashboard-invalid-data');
    if(entry.lease?.token!==lease.token){
      vbDashR8Log('superseded-owner-result-rejected');
      if(entry.data&&entry.expires>Date.now())return vbDashR8Result(entry.data,'newer-completed-data');
      throw vbRepError('dashboard-refresh-superseded',503,5);
    }
    entry.data=data;entry.expires=Date.now()+VB_DASH_R8_TTL;
    vbDashR8Log('build-complete',{elapsedMs:Date.now()-lease.startedAt});
    return vbDashR8Result(data,'built');
  }finally{
    // An expired owner's late completion must not clear a replacement owner's lease.
    if(entry.lease?.token===lease.token)entry.lease=null;
  }
}
// Only the dashboard cache changes; independent Chat/daily/name caches stay intact.
buildWebexDashboardData=env=>vbDashR8Build(env);
const vbDashR8RetainedHandler=handleWebexDashboard;
handleWebexDashboard=async function(request,env,cors){
  const started=Date.now();vbDashR8Log('request-start');
  try{
    const response=await vbRepBound(vbDashR8RetainedHandler(request,env,cors),started+40000,'dashboard-request-deadline');
    vbDashR8Log('request-complete',{elapsedMs:Date.now()-started,http:response.status});return response;
  }catch{
    vbDashR8Log('request-deadline-or-error',{elapsedMs:Date.now()-started});
    return json({success:false,error:'reporting-temporarily-unavailable',
      dashboardLifecycleRevision:VB_DASHBOARD_R8,retryAfterSeconds:5},
      {...cors,'Cache-Control':'no-store','Retry-After':'5'},503);
  }
};
