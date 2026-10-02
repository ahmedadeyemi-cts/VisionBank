(() => {
  "use strict";
  const SECURITY_BASE="https://visionbank-security.ahmedadeyemi.workers.dev";
  const API_BASE=SECURITY_BASE+"/api/webex/device-management";
  const state={capabilities:null,locations:[],devices:[],filtered:[],selected:null,members:[],preview:null};

  const $=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const text=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
  const normalize=value=>String(value??"").trim().toLowerCase();
  const lineStatus=line=>normalize(line?.registrationStatus||line?.status||"unknown");
  const statusClass=value=>{const s=normalize(value);return s.includes("register")&&!s.includes("unregister")?"registered":s.includes("unregister")||s.includes("failed")?"unregistered":s.includes("pending")?"pending":"unknown";};
  const syncClass=value=>{const s=normalize(value);return s==="in-sync"||s==="synced"?"registered":s.includes("mismatch")||s.includes("attention")?"mismatch":s.includes("pending")?"pending":"unknown";};

  async function securityCheck(){
    const overlay=$("deviceAccessOverlay"),message=$("deviceAccessMessage");
    try{
      const res=await fetch(SECURITY_BASE+"/security/check",{mode:"cors",credentials:"omit",cache:"no-store"});
      const data=await res.json();
      window.VB_SECURITY=data;
      if(!res.ok||data.allowed!==true)throw new Error("Access is not approved from this network.");
      document.body.classList.add("access-approved");
      text("deviceSecurityStatus","Approved network");
      return true;
    }catch(error){
      if(overlay)overlay.style.display="grid";
      if(message)message.textContent=error?.message||"Unable to verify approved access.";
      text("deviceSecurityStatus","Access unavailable");
      return false;
    }
  }

  async function api(path,options={}){
    const method=options.method||"GET",body=options.body;
    if(window.VB_SECURITY?.allowed!==true)throw new Error("Dashboard access is not approved.");
    const res=await fetch(API_BASE+path,{
      method,mode:"cors",credentials:"omit",cache:"no-store",
      headers:{Accept:"application/json",...(body!==undefined?{"Content-Type":"application/json"}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{})
    });
    let data={};try{data=await res.json();}catch{}
    if(!res.ok||data.success===false){
      const e=new Error(data.error||data.message||("HTTP "+res.status));
      e.status=res.status;throw e;
    }
    return data;
  }

  function healthDot(id,status){
    const el=$(id);if(!el)return;
    el.className="device-dot "+(status==="ready"?"ok":status==="warning"?"warn":status==="blocked"?"bad":"");
  }
  function renderCheckList(id,items){
    const host=$(id);if(!host)return;
    host.innerHTML=items.length?items.map(item=>{
      const label=typeof item==="string"?item:(item.label||item.name||"Check");
      const suffix=typeof item==="object"&&item.status?(" — <strong>"+esc(item.status)+"</strong>"):"";
      return "<li>"+esc(label)+suffix+"</li>";
    }).join(""):"<li>No checks reported yet.</li>";
  }

  function setCapabilities(data){
    state.capabilities=data;
    const webex=data?.webex||{},phonism=data?.phonism||{},writes=data?.writes||{};
    healthDot("deviceWebexDot",webex.ready?"ready":webex.detected?"warning":"blocked");
    healthDot("devicePhonismDot",phonism.ready?"ready":phonism.detected?"warning":"blocked");
    healthDot("deviceWriteDot",writes.enabled?"ready":writes.previewReady?"warning":"blocked");
    text("deviceWebexHealth",webex.message||(webex.ready?"Connected":"Not ready"));
    text("devicePhonismHealth",phonism.message||(phonism.ready?"Connected":"Not configured"));
    text("deviceWriteHealth",writes.message||(writes.enabled?"Changes enabled":"Read-only until validated"));
    text("deviceHealthWebexText",webex.detail||webex.message||"Webex capability check pending.");
    text("deviceHealthPhonismText",phonism.detail||phonism.message||"Phonism capability check pending.");
    renderCheckList("deviceHealthWebexChecks",webex.checks||[]);
    renderCheckList("deviceHealthPhonismChecks",phonism.checks||[]);
  }

  async function loadCapabilities(){
    try{
      const data=await api("/capabilities");
      setCapabilities(data);
      return data;
    }catch(error){
      setCapabilities({
        webex:{detected:true,ready:false,message:"Backend discovery pending",detail:"The /device page is installed; Webex device-management API discovery has not been activated yet."},
        phonism:{detected:false,ready:false,message:"API details required",detail:"Provide the Phonism API base URL/documentation and an API credential with device read/write permissions plus the exact reprovision/reset action."},
        writes:{enabled:false,previewReady:false,message:"Read-only until both systems are validated"}
      });
      if(error.status!==404)console.debug("Device capabilities unavailable:",error.message);
      return null;
    }
  }

  async function loadLocations(){
    try{
      const data=await api("/locations");
      state.locations=Array.isArray(data.locations)?data.locations:[];
      const select=$("deviceLocationFilter"),current=select.value;
      select.innerHTML='<option value="">All permitted locations</option>'+state.locations.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name||"Location")+'</option>').join("");
      if([...select.options].some(o=>o.value===current))select.value=current;
    }catch(error){
      state.locations=[];
      if(error.status!==404)console.debug("Location inventory unavailable:",error.message);
    }
  }

  async function loadInventory(force=false){
    const body=$("deviceInventoryRows");
    text("deviceInventoryStatus","Loading phones and line assignments…");
    if(body&&!state.devices.length)body.innerHTML='<tr><td colspan="8" class="device-empty">Loading inventory…</td></tr>';
    const locationId=$("deviceLocationFilter")?.value||"";
    try{
      const q=new URLSearchParams();
      if(locationId)q.set("locationId",locationId);
      if(force)q.set("refresh","1");
      const data=await api("/inventory"+(q.size?"?"+q.toString():""));
      state.devices=Array.isArray(data.devices)?data.devices:[];
      text("deviceSyncStamp",data.generatedAt?("Updated "+new Date(data.generatedAt).toLocaleTimeString()):"Inventory updated");
      applyFilters();
    }catch(error){
      state.devices=[];state.filtered=[];
      if(body)body.innerHTML='<tr><td colspan="8" class="device-empty">Device inventory is not active yet. '+esc(error.status===404?"Backend integration is being prepared.":error.message)+'</td></tr>';
      text("deviceInventoryStatus","No live inventory has been loaded.");
      renderKpis();
    }
  }

  function deviceSearchText(d){
    return [d.displayName,d.model,d.mac,d.locationName,d.owner?.name,d.owner?.extension,
      d.line1?.name,d.line1?.extension,d.line2?.name,d.line2?.extension].map(normalize).join(" ");
  }
  function applyFilters(){
    const term=normalize($("deviceSearch")?.value);
    const owner=$("deviceOwnerFilter")?.value||"";
    const registration=$("deviceRegistrationFilter")?.value||"";
    state.filtered=state.devices.filter(d=>{
      if(term&&!deviceSearchText(d).includes(term))return false;
      if(owner&&String(d.owner?.type||"").toUpperCase()!==owner)return false;
      if(registration){
        const statuses=[lineStatus(d.line1),lineStatus(d.line2)].filter(Boolean);
        if(!statuses.some(s=>s===registration))return false;
      }
      return true;
    });
    renderInventory();renderKpis();
  }

  function renderKpis(){
    text("deviceKpiPhones",state.filtered.length.toLocaleString());
    let registered=0,attention=0,pending=0;
    state.filtered.forEach(d=>{
      for(const line of [d.line1,d.line2]){
        if(line&&statusClass(lineStatus(line))==="registered")registered++;
      }
      if([d.line1,d.line2].some(l=>l&&statusClass(lineStatus(l))==="unregistered")||syncClass(d.syncStatus)==="mismatch")attention++;
      if(syncClass(d.syncStatus)==="pending")pending++;
    });
    text("deviceKpiRegistered",registered.toLocaleString());
    text("deviceKpiAttention",attention.toLocaleString());
    text("deviceKpiPending",pending.toLocaleString());
  }

  function lineCell(line){
    if(!line)return '<span class="device-badge neutral">None</span>';
    const status=line.registrationStatus||line.status||"Unknown";
    return '<strong>'+esc(line.name||line.displayName||"Assigned line")+'</strong>'+
      '<small>'+esc(line.extension||line.phoneNumber||"No extension")+'</small>'+
      '<span class="device-status '+statusClass(status)+'">'+esc(status)+'</span>';
  }

  function renderInventory(){
    const body=$("deviceInventoryRows");if(!body)return;
    text("deviceInventoryCount",state.filtered.length+" device"+(state.filtered.length===1?"":"s"));
    text("deviceInventoryStatus",state.devices.length?(state.filtered.length+" of "+state.devices.length+" devices shown."):"No devices returned.");
    if(!state.filtered.length){
      body.innerHTML='<tr><td colspan="8" class="device-empty">No devices match the current filters.</td></tr>';
      return;
    }
    body.innerHTML=state.filtered.map(d=>'<tr>'+
      '<td><strong>'+esc(d.displayName||d.model||"Phone")+'</strong><small>'+esc(d.model||"Unknown model")+' · '+esc(d.mac||"MAC unavailable")+'</small></td>'+
      '<td>'+esc(d.locationName||"Unknown")+'<small>'+esc(d.locationCode||"")+'</small></td>'+
      '<td><strong>'+esc(d.owner?.name||"Unassigned")+'</strong><small>'+esc(d.owner?.type||"")+' '+esc(d.owner?.extension||"")+'</small></td>'+
      '<td>'+lineCell(d.line1)+'</td><td>'+lineCell(d.line2)+'</td>'+
      '<td><span class="device-status '+syncClass(d.syncStatus)+'">'+esc(d.syncStatusLabel||d.syncStatus||"Unknown")+'</span><small>'+esc(d.syncMessage||"")+'</small></td>'+
      '<td>'+esc(d.lastProvision||"Not reported")+'<small>'+esc(d.phonismStatus||"")+'</small></td>'+
      '<td><button class="device-row-action" type="button" data-device-edit="'+esc(d.id)+'">Manage lines</button></td></tr>').join("");
    body.querySelectorAll("[data-device-edit]").forEach(btn=>btn.addEventListener("click",()=>openEditor(btn.dataset.deviceEdit)));
  }

  async function loadMembers(device){
    state.members=[];
    const select=$("deviceLine2Select");
    if(select)select.innerHTML='<option value="">None</option>';
    try{
      const q=new URLSearchParams();
      q.set("locationId",device.locationId||"");
      q.set("deviceId",device.id);
      const data=await api("/members?"+q.toString());
      state.members=Array.isArray(data.members)?data.members:[];
      if(select){
        select.innerHTML='<option value="">None</option>'+state.members.map(m=>
          '<option value="'+esc(m.id)+'">'+esc(m.name||"Member")+' · '+esc(m.extension||m.phoneNumber||"No extension")+' · '+esc(m.type||"")+'</option>'
        ).join("");
      }
    }catch(error){
      if(error.status!==404)console.debug("Member search unavailable:",error.message);
    }
  }

  async function openEditor(id){
    const device=state.devices.find(d=>String(d.id)===String(id));if(!device)return;
    state.selected=device;state.preview=null;
    text("deviceEditorTitle",device.displayName||device.model||"Phone");
    text("deviceEditorMeta",[device.locationName,device.mac].filter(Boolean).join(" · "));
    text("deviceLine1Name",device.line1?.name||device.owner?.name||"Primary line");
    text("deviceLine1Extension",device.line1?.extension||device.owner?.extension||"No extension");
    const s=device.line1?.registrationStatus||device.line1?.status||"Unknown";
    const status=$("deviceLine1Status");
    if(status){status.textContent=s;status.className="device-status "+statusClass(s);}
    await loadMembers(device);
    const select=$("deviceLine2Select");
    if(select){
      select.value=device.line2?.memberId||device.line2?.id||"";
      select.onchange=renderCandidate;
    }
    renderCandidate();
    const enabled=state.capabilities?.writes?.enabled===true;
    $("devicePreviewChange").disabled=!enabled;
    text("deviceEditorWarning",enabled?"Review the proposed Line 2 change before applying it. Current state will be revalidated first.":"Changes remain disabled until Webex and Phonism write capabilities and the exact post-save action are validated.");
    $("deviceEditor")?.showModal();
  }

  function renderCandidate(){
    const id=$("deviceLine2Select")?.value||"";
    const m=state.members.find(x=>String(x.id)===String(id));
    text("deviceLine2CandidateMeta",m?(String(m.name||"Member")+" · "+String(m.extension||m.phoneNumber||"No extension")+" · "+String(m.type||"")+" · same location validated by backend"):"None — Line 2 will be unassigned.");
  }

  async function previewChange(){
    if(!state.selected)return;
    const memberId=$("deviceLine2Select")?.value||null;
    const button=$("devicePreviewChange");button.disabled=true;
    try{
      const data=await api("/preview",{method:"POST",body:{
        deviceId:state.selected.id,
        locationId:state.selected.locationId,
        targetLine2MemberId:memberId
      }});
      state.preview=data.plan||data;
      renderConfirm(state.preview);
      $("deviceConfirm")?.showModal();
    }catch(error){
      text("deviceEditorWarning","Unable to prepare change: "+error.message);
    }finally{
      button.disabled=state.capabilities?.writes?.enabled!==true;
    }
  }

  function renderConfirm(plan){
    const host=$("deviceConfirmBody");if(!host)return;
    const before=plan.before?.line2||state.selected?.line2;
    const after=plan.after?.line2;
    host.innerHTML=
      '<div class="device-confirm-row"><span>Phone</span><strong>'+esc(plan.device?.displayName||state.selected?.displayName||"Phone")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Location</span><strong>'+esc(plan.location?.name||state.selected?.locationName||"Location")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Current Line 2</span><strong>'+esc(before?.name||"None")+' '+esc(before?.extension||"")+'</strong></div>'+
      '<div class="device-confirm-row"><span>New Line 2</span><strong>'+esc(after?.name||"None")+' '+esc(after?.extension||"")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Post-save action</span><strong>'+esc(plan.phonismActionLabel||"Verified Phonism action")+'</strong></div>'+
      '<p class="device-helper">'+esc(plan.summary||"The backend will revalidate current state before any write.")+'</p>';
    $("deviceApplyChange").disabled=plan.executable!==true;
  }

  async function applyChange(){
    if(!state.preview)return;
    const btn=$("deviceApplyChange");btn.disabled=true;btn.textContent="Applying…";
    try{
      const result=await api("/apply",{method:"POST",body:{
        mutationId:state.preview.mutationId,
        expectedVersion:state.preview.expectedVersion
      }});
      $("deviceConfirm")?.close();$("deviceEditor")?.close();
      text("deviceInventoryStatus",result.message||"Change accepted. Refreshing device state…");
      await loadInventory(true);
    }catch(error){
      const host=$("deviceConfirmBody");
      if(host)host.insertAdjacentHTML("beforeend",'<p class="device-warning">Change was not completed: '+esc(error.message)+'</p>');
    }finally{
      btn.textContent="Save & Apply";
    }
  }

  async function loadHistory(){
    const body=$("deviceHistoryRows");
    if(body)body.innerHTML='<tr><td colspan="7" class="device-empty">Loading history…</td></tr>';
    try{
      const data=await api("/history");
      const rows=Array.isArray(data.rows)?data.rows:[];
      if(body)body.innerHTML=rows.length?rows.map(r=>
        '<tr><td>'+esc(r.when||r.at||"")+'</td>'+
        '<td>'+esc(r.deviceName||r.mac||"")+'</td>'+
        '<td>'+esc(r.locationName||"")+'</td>'+
        '<td>'+esc(r.change||r.summary||"")+'</td>'+
        '<td>'+esc(r.webexStatus||"—")+'</td>'+
        '<td>'+esc(r.phonismStatus||"—")+'</td>'+
        '<td><span class="device-status '+statusClass(r.result)+'">'+esc(r.result||"Unknown")+'</span></td></tr>'
      ).join(""):'<tr><td colspan="7" class="device-empty">No device-management changes have been recorded yet.</td></tr>';
    }catch(error){
      if(body)body.innerHTML='<tr><td colspan="7" class="device-empty">History is not active yet. '+esc(error.status===404?"Backend audit storage is being prepared.":error.message)+'</td></tr>';
    }
  }

  function bind(){
    document.querySelectorAll("[data-device-tab]").forEach(btn=>btn.addEventListener("click",()=>{
      const tab=btn.dataset.deviceTab;
      document.querySelectorAll("[data-device-tab]").forEach(b=>b.classList.toggle("active",b===btn));
      document.querySelectorAll("[data-device-view]").forEach(v=>v.hidden=v.dataset.deviceView!==tab);
      if(tab==="history")void loadHistory();
    }));
    $("deviceSearch")?.addEventListener("input",applyFilters);
    $("deviceOwnerFilter")?.addEventListener("change",applyFilters);
    $("deviceRegistrationFilter")?.addEventListener("change",applyFilters);
    $("deviceLocationFilter")?.addEventListener("change",()=>void loadInventory(true));
    $("deviceClearFilters")?.addEventListener("click",()=>{
      $("deviceSearch").value="";$("deviceOwnerFilter").value="";$("deviceRegistrationFilter").value="";applyFilters();
    });
    $("deviceRefresh")?.addEventListener("click",async()=>{await loadCapabilities();await loadLocations();await loadInventory(true);});
    $("deviceHistoryRefresh")?.addEventListener("click",()=>void loadHistory());
    $("devicePreviewChange")?.addEventListener("click",()=>void previewChange());
    $("deviceApplyChange")?.addEventListener("click",()=>void applyChange());
    $("deviceConfirmClose")?.addEventListener("click",()=>$("deviceConfirm")?.close());
    $("deviceConfirmCancel")?.addEventListener("click",()=>$("deviceConfirm")?.close());
  }

  async function init(){
    bind();
    if(!await securityCheck())return;
    await loadCapabilities();
    await loadLocations();
    await loadInventory(false);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else void init();
})();
