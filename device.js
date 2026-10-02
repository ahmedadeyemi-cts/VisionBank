(() => {
  "use strict";
  const SECURITY_BASE="https://visionbank-security.ahmedadeyemi.workers.dev";
  const API_BASE=SECURITY_BASE+"/api/webex/device-management";
  const OPERATOR_KEY="visionbankDeviceOperatorV1";
  const state={capabilities:null,locations:[],devices:[],filtered:[],selected:null,members:[],memberLoadError:null,preview:null,recovery:null,operatorSession:null,pendingOperatorAction:null};

  const $=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const text=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
  const normalize=value=>String(value??"").trim().toLowerCase();
  const lineStatus=line=>normalize(line?.registrationStatus||line?.status||"unknown");
  const statusClass=value=>{const s=normalize(value);return s.includes("register")&&!s.includes("unregister")?"registered":s.includes("unregister")||s.includes("failed")?"unregistered":s.includes("pending")||s.includes("connecting")?"pending":"unknown";};
  const registrationLabel=value=>{const s=normalize(value);if(s==="registered")return "Registered";if(s==="unregistered")return "Unregistered";if(s==="pending")return "Pending";if(s==="not-monitored")return "Not monitored";if(s==="connected")return "Connected";return "Unknown";};
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
    const sessionId=state.operatorSession?.sessionId||"";
    const res=await fetch(API_BASE+path,{
      method,mode:"cors",credentials:"omit",cache:"no-store",
      headers:{Accept:"application/json",...(sessionId?{"X-VB-Operator-Session":sessionId}:{}),...(body!==undefined?{"Content-Type":"application/json"}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{})
    });
    let data={};try{data=await res.json();}catch{}
    if(!res.ok||data.success===false){
      const e=new Error(data.error||data.message||("HTTP "+res.status));
      e.status=res.status;throw e;
    }
    return data;
  }

  function renderOperator(){
    const session=state.operatorSession,operator=session?.operator;
    text("deviceOperatorName",operator?.name||"Not identified");
    text("deviceOperatorEmail",operator?.email||"Required before changes");
    text("deviceOperatorButton",operator?"Change Operator":"Identify Operator");
    const chip=$("deviceOperatorChip");if(chip)chip.classList.toggle("identified",Boolean(operator));
  }

  function saveOperatorSession(session){
    state.operatorSession=session||null;
    try{
      if(session)sessionStorage.setItem(OPERATOR_KEY,JSON.stringify(session));
      else sessionStorage.removeItem(OPERATOR_KEY);
    }catch{}
    renderOperator();
  }

  async function restoreOperatorSession(){
    let saved=null;
    try{saved=JSON.parse(sessionStorage.getItem(OPERATOR_KEY)||"null");}catch{}
    if(!saved?.sessionId){renderOperator();return;}
    state.operatorSession=saved;
    try{
      const data=await api("/operator-session");
      saveOperatorSession({sessionId:data.sessionId,operator:data.operator,startedAt:data.startedAt,expiresAt:data.expiresAt});
    }catch{
      saveOperatorSession(null);
    }
  }

  function showOperatorDialog(pendingAction=null){
    state.pendingOperatorAction=pendingAction;
    const operator=state.operatorSession?.operator||{};
    const name=$("deviceOperatorFullName"),email=$("deviceOperatorWorkEmail");
    if(name)name.value=operator.name||"";
    if(email)email.value=operator.email||"";
    text("deviceOperatorMessage","This identity is kept for this browser session. IP address and browser information are captured server-side for audited changes.");
    $("deviceOperatorDialog")?.showModal();
    setTimeout(()=>name?.focus(),0);
  }

  async function submitOperator(event){
    event.preventDefault();
    const button=$("deviceOperatorSave");if(button)button.disabled=true;
    const name=$("deviceOperatorFullName")?.value||"",email=$("deviceOperatorWorkEmail")?.value||"";
    try{
      const data=await api("/operator-session",{method:"POST",body:{name,email}});
      saveOperatorSession({sessionId:data.sessionId,operator:data.operator,startedAt:data.startedAt,expiresAt:data.expiresAt});
      $("deviceOperatorDialog")?.close();
      const pending=state.pendingOperatorAction;state.pendingOperatorAction=null;
      if(pending?.type==="edit"&&pending.id)await openEditor(pending.id);
    }catch(error){
      text("deviceOperatorMessage","Unable to identify operator: "+error.message);
    }finally{if(button)button.disabled=false;}
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
    healthDot("deviceWriteDot",writes.enabled?"ready":(data?.readOnly===true||writes.previewReady)?"warning":"blocked");
    text("deviceWebexHealth",webex.message||(webex.ready?"Connected":"Not ready"));
    text("devicePhonismHealth",phonism.message||(phonism.ready?"Connected":"Not configured"));
    text("deviceWriteHealth",writes.enabled?(writes.message||"Changes enabled"):(data?.readOnly===true?"Read-only pilot — changes disabled":(writes.message||"Read-only until validated")));
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
      select.innerHTML='<option value="">All VisionBank locations</option>'+state.locations.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name||"Location")+'</option>').join("");
      if([...select.options].some(o=>o.value===current))select.value=current;
    }catch(error){
      state.locations=[];
      if(error.status!==404)console.debug("Location inventory unavailable:",error.message);
    }
  }

  async function loadInventory(force=false){
    const body=$("deviceInventoryRows");
    const locationId=$("deviceLocationFilter")?.value||"";
    text("deviceInventoryStatus",locationId?"Loading detailed phone and line assignments…":"Loading VisionBank Iowa phone inventory…");
    if(body&&!state.devices.length)body.innerHTML='<tr><td colspan="9" class="device-empty">Loading inventory…</td></tr>';
    try{
      const q=new URLSearchParams();
      if(locationId)q.set("locationId",locationId);
      if(force)q.set("refresh","1");
      const data=await api("/inventory"+(q.size?"?"+q.toString():""));
      state.devices=Array.isArray(data.devices)?data.devices:[];
      text("deviceSyncStamp",data.generatedAt?("Updated "+new Date(data.generatedAt).toLocaleTimeString()):"Inventory updated");
      text("deviceInventoryStatus",data.message||(data.summaryOnly?("Showing "+state.devices.length+" VisionBank phones. Select a location for line details."):("Loaded "+state.devices.length+" phones with detailed provider data.")));
      applyFilters();
    }catch(error){
      state.devices=[];state.filtered=[];
      if(body)body.innerHTML='<tr><td colspan="9" class="device-empty">Device inventory could not be loaded. '+esc(error.status===404?"Backend integration is being prepared.":error.message)+'</td></tr>';
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
    const webexFilter=$("deviceWebexRegistrationFilter")?.value||"";
    const phonismFilter=$("devicePhonismRegistrationFilter")?.value||"";
    state.filtered=state.devices.filter(d=>{
      if(term&&!deviceSearchText(d).includes(term))return false;
      if(owner&&String(d.owner?.type||"").toUpperCase()!==owner)return false;
      if(webexFilter){
        const statuses=[d.line1,d.line2].filter(Boolean).map(l=>statusClass(registrationValue(l,"webex")));
        if(!statuses.includes(webexFilter))return false;
      }
      if(phonismFilter){
        const statuses=[d.line1,d.line2].filter(Boolean).map(l=>statusClass(registrationValue(l,"phonism")));
        if(!statuses.includes(phonismFilter))return false;
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
        if(!line)continue;
        const wx=statusClass(registrationValue(line,"webex"));
        const ph=statusClass(registrationValue(line,"phonism"));
        if(wx==="registered"||ph==="registered")registered++;
      }
      if([d.line1,d.line2].some(l=>l&&(statusClass(registrationValue(l,"webex"))==="unregistered"||statusClass(registrationValue(l,"phonism"))==="unregistered"))||syncClass(d.syncStatus)==="mismatch")attention++;
      if(d.temporaryLease?.status==="active")pending++;
    });
    text("deviceKpiRegistered",registered.toLocaleString());
    text("deviceKpiAttention",attention.toLocaleString());
    text("deviceKpiPending",pending.toLocaleString());
  }

  function registrationValue(line,system){
    if(!line)return "Unknown";
    if(system==="webex")return line.webexRegistrationStatus||line.registrationStatus||line.status||"Unknown";
    return line.phonismRegistrationStatus||"Unknown";
  }

  function lineHealthy(line){
    if(!line)return true;
    const webex=statusClass(registrationValue(line,"webex"));
    const phonism=statusClass(registrationValue(line,"phonism"));
    return webex==="registered"&&phonism==="registered";
  }

  function lineCell(line,detailsLoaded=true){
    if(!detailsLoaded)return '<span class="device-badge neutral">Select location for line details</span>';
    if(!line)return '<span class="device-badge neutral">None</span>';
    const webex=registrationValue(line,"webex"),phonism=registrationValue(line,"phonism");
    return '<strong>'+esc(line.name||line.displayName||"Assigned line")+'</strong>'+
      '<small>'+esc(line.extension||line.phoneNumber||"No extension")+'</small>'+
      '<div class="device-dual-status"><span>Webex <b class="device-status '+statusClass(webex)+'">'+esc(registrationLabel(webex))+'</b></span>'+
      '<span>Phonism <b class="device-status '+statusClass(phonism)+'">'+esc(registrationLabel(phonism))+'</b></span></div>';
  }

  function leaseCell(device){
    const lease=device?.temporaryLease;
    if(!lease||lease.status!=="active"||!lease.expiresAt)return '<span class="device-badge neutral">Permanent</span>';
    const when=new Date(lease.expiresAt);
    const label=Number.isNaN(when.getTime())?lease.expiresAt:when.toLocaleString();
    return '<span class="device-status pending">Temporary</span><small>Expires '+esc(label)+'</small>';
  }

  function renderInventory(){
    const body=$("deviceInventoryRows");if(!body)return;
    text("deviceInventoryCount",state.filtered.length+" device"+(state.filtered.length===1?"":"s"));
    text("deviceInventoryStatus",state.devices.length?(state.filtered.length+" of "+state.devices.length+" devices shown."):"No devices returned.");
    if(!state.filtered.length){
      body.innerHTML='<tr><td colspan="9" class="device-empty">No devices match the current filters.</td></tr>';
      return;
    }
    body.innerHTML=state.filtered.map(d=>'<tr>'+
      '<td><strong>'+esc(d.displayName||d.model||"Phone")+'</strong><small>'+esc(d.model||"Unknown model")+' · '+esc(d.mac||"MAC unavailable")+'</small></td>'+
      '<td>'+esc(d.locationName||"Unknown")+'<small>'+esc(d.locationCode||"")+'</small></td>'+
      '<td><strong>'+esc(d.owner?.name||"Unassigned")+'</strong><small>'+esc(d.owner?.type||"")+' '+esc(d.owner?.extension||"")+'</small></td>'+
      '<td>'+lineCell(d.line1,d.detailsLoaded!==false)+'</td><td>'+lineCell(d.line2,d.detailsLoaded!==false)+'</td>'+
      '<td>'+leaseCell(d)+'</td>'+
      '<td><span class="device-status '+syncClass(d.syncStatus)+'">'+esc(d.syncStatusLabel||d.syncStatus||"Unknown")+'</span><small>'+esc(d.syncMessage||"")+'</small></td>'+
      '<td>'+esc(d.lastProvision||"Not reported")+'<small>'+esc(d.phonismStatus||"")+'</small></td>'+
      '<td>'+(d.detailsLoaded===false?'<button class="device-row-action" type="button" data-device-location="'+esc(d.locationId||"")+'">Open location</button>':'<button class="device-row-action" type="button" data-device-edit="'+esc(d.id)+'">Manage lines</button>')+'</td></tr>').join("");
    body.querySelectorAll("[data-device-edit]").forEach(btn=>btn.addEventListener("click",()=>openEditor(btn.dataset.deviceEdit)));
    body.querySelectorAll("[data-device-location]").forEach(btn=>btn.addEventListener("click",async()=>{
      const locationId=btn.dataset.deviceLocation||"";
      if(!locationId)return;
      const filter=$("deviceLocationFilter");if(filter)filter.value=locationId;
      await loadInventory(true);
    }));
  }

  async function loadMembers(device){
    state.members=[];state.memberLoadError=null;
    const select=$("deviceLine2Select");
    if(select){select.disabled=true;select.innerHTML='<option value="">Loading eligible lines…</option>';}
    text("deviceLine2CandidateMeta","Loading eligible users and workspaces from Webex…");
    try{
      const q=new URLSearchParams();
      q.set("locationId",device.locationId||"");
      q.set("deviceId",device.id);
      const data=await api("/members?"+q.toString());
      state.members=Array.isArray(data.members)?data.members:[];
      if(select){
        select.disabled=false;
        select.innerHTML='<option value="">None</option>'+state.members.map(m=>
          '<option value="'+esc(m.id)+'">'+esc(m.name||"Member")+' · '+esc(m.extension||m.phoneNumber||"No extension")+' · '+esc(m.type||"")+'</option>'
        ).join("");
      }
      text("deviceLine2CandidateMeta",state.members.length?state.members.length+" eligible same-location line"+(state.members.length===1?"":"s")+" available.":"No eligible same-location lines were returned by Webex.");
    }catch(error){
      state.memberLoadError=error.message||"member-search-failed";
      if(select){select.disabled=true;select.innerHTML='<option value="">Unable to load available lines</option>';}
      text("deviceLine2CandidateMeta","Unable to load available lines: "+state.memberLoadError);
      if(error.status!==404)console.debug("Member search unavailable:",error.message);
    }
  }

  async function openEditor(id){
    if(!state.operatorSession){showOperatorDialog({type:"edit",id});return;}
    const device=state.devices.find(d=>String(d.id)===String(id));if(!device)return;
    state.selected=device;state.preview=null;state.recovery=null;
    const duration=$("deviceLeaseDuration");if(duration)duration.value="60";
    const reason=$("deviceChangeReason");if(reason)reason.value="";
    text("deviceEditorTitle",device.displayName||device.model||"Phone");
    text("deviceEditorMeta",[device.locationName,device.mac].filter(Boolean).join(" · "));
    text("deviceLine1Name",device.line1?.name||device.owner?.name||"Primary line");
    text("deviceLine1Extension",device.line1?.extension||device.owner?.extension||"No extension");
    const wx=registrationValue(device.line1,"webex"),ph=registrationValue(device.line1,"phonism");
    const status=$("deviceLine1Status");
    if(status){status.textContent="Webex: "+registrationLabel(wx)+" · Phonism: "+registrationLabel(ph);status.className="device-status "+(lineHealthy(device.line1)?"registered":"unknown");}
    await loadMembers(device);
    const select=$("deviceLine2Select");
    if(select){
      select.value=device.line2?.memberId||device.line2?.id||"";
      select.onchange=renderCandidate;
    }
    renderCandidate();
    const enabled=state.capabilities?.writes?.enabled===true;
    $("devicePreviewChange").disabled=!enabled;
    text("deviceEditorWarning",enabled?"Review the proposed Line 2 change before Save & Sync. Current state will be revalidated first.":"Changes remain disabled until Webex write support and the Phonism Sync API are validated. Factory Reset remains recovery-only.");
    $("deviceEditor")?.showModal();
  }

  function renderCandidate(){
    if(state.memberLoadError){text("deviceLine2CandidateMeta","Unable to load available lines: "+state.memberLoadError);return;}
    const id=$("deviceLine2Select")?.value||"";
    const m=state.members.find(x=>String(x.id)===String(id));
    if(m){text("deviceLine2CandidateMeta",String(m.name||"Member")+" · "+String(m.extension||m.phoneNumber||"No extension")+" · "+String(m.type||"")+" · same location validated by backend");return;}
    text("deviceLine2CandidateMeta","None — Line 2 will be unassigned. "+state.members.length+" eligible same-location line"+(state.members.length===1?"":"s")+" available.");
  }

  async function previewChange(){
    if(!state.selected)return;
    const memberId=$("deviceLine2Select")?.value||null;
    const button=$("devicePreviewChange");button.disabled=true;
    try{
      const durationMinutes=Number($("deviceLeaseDuration")?.value||60);
      const data=await api("/preview",{method:"POST",body:{
        deviceId:state.selected.id,
        locationId:state.selected.locationId,
        targetLine2MemberId:memberId,
        durationMinutes,
        reason:($("deviceChangeReason")?.value||"").trim()
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
      '<div class="device-confirm-row"><span>Operator</span><strong>'+esc(state.operatorSession?.operator?.name||"Unknown")+' · '+esc(state.operatorSession?.operator?.email||"")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Phone</span><strong>'+esc(plan.device?.displayName||state.selected?.displayName||"Phone")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Location</span><strong>'+esc(plan.location?.name||state.selected?.locationName||"Location")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Current Line 2</span><strong>'+esc(before?.name||"None")+' '+esc(before?.extension||"")+'</strong></div>'+
      '<div class="device-confirm-row"><span>New Line 2</span><strong>'+esc(after?.name||"None")+' '+esc(after?.extension||"")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Temporary duration</span><strong>'+esc(plan.lease?.durationMinutes?String(plan.lease.durationMinutes)+" minutes":"Temporary")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Auto-revert</span><strong>'+esc(plan.lease?.expiresAt?new Date(plan.lease.expiresAt).toLocaleString():"At lease expiry")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Post-save action</span><strong>'+esc(plan.phonismActionLabel||"Phonism Sync + registration verification")+'</strong></div>'+
      (($("deviceChangeReason")?.value||"").trim()?'<div class="device-confirm-row"><span>Reason</span><strong>'+esc(($("deviceChangeReason")?.value||"").trim())+'</strong></div>':"")+
      '<p class="device-helper">'+esc(plan.summary||"The backend will revalidate current state before any write.")+'</p>';
    $("deviceApplyChange").disabled=plan.executable!==true;
  }

  async function applyChange(){
    if(!state.preview)return;
    const btn=$("deviceApplyChange");btn.disabled=true;btn.textContent="Saving & Syncing…";
    try{
      const result=await api("/apply",{method:"POST",body:{
        mutationId:state.preview.mutationId,
        expectedVersion:state.preview.expectedVersion,
        durationMinutes:state.preview.lease?.durationMinutes||Number($("deviceLeaseDuration")?.value||60),
        reason:($("deviceChangeReason")?.value||"").trim()
      }});
      $("deviceConfirm")?.close();$("deviceEditor")?.close();
      text("deviceInventoryStatus",result.message||"Save & Sync accepted. Verifying Webex and Phonism registration…");
      await loadInventory(true);
      if(result.recoveryEligible===true&&result.recovery){
        state.recovery=result.recovery;
        text("deviceRecoveryReason",result.recovery.reason||"Line 2 is still not registered after Save & Sync verification.");
        const confirm=$("deviceRecoveryConfirm");if(confirm)confirm.checked=false;
        $("deviceFactoryReset").disabled=true;
        $("deviceRecovery")?.showModal();
      }
    }catch(error){
      const host=$("deviceConfirmBody");
      if(host)host.insertAdjacentHTML("beforeend",'<p class="device-warning">Save & Sync was not completed: '+esc(error.message)+'</p>');
    }finally{
      btn.textContent="Save & Sync";
    }
  }

  async function factoryResetRecovery(){
    if(!state.recovery||$("deviceRecoveryConfirm")?.checked!==true)return;
    const btn=$("deviceFactoryReset");btn.disabled=true;btn.textContent="Resetting & Reprovisioning…";
    try{
      const result=await api("/factory-reset",{method:"POST",body:{
        recoveryId:state.recovery.recoveryId,
        expectedVersion:state.recovery.expectedVersion
      }});
      $("deviceRecovery")?.close();state.recovery=null;
      text("deviceInventoryStatus",result.message||"Factory reset accepted. Waiting for phone reprovisioning and line registration…");
      await loadInventory(true);
    }catch(error){
      text("deviceRecoveryReason","Factory reset recovery was not completed: "+error.message);
    }finally{
      btn.textContent="Factory Reset & Reprovision";
      btn.disabled=$("deviceRecoveryConfirm")?.checked!==true||!state.recovery;
    }
  }

  async function loadHistory(){
    const body=$("deviceHistoryRows");
    if(body)body.innerHTML='<tr><td colspan="9" class="device-empty">Loading history…</td></tr>';
    try{
      const data=await api("/history?limit=100");
      const rows=Array.isArray(data.rows)?data.rows:[];
      if(body)body.innerHTML=rows.length?rows.map(r=>
        '<tr><td>'+esc(r.at?new Date(r.at).toLocaleString():"")+'</td>'+
        '<td><strong>'+esc(r.operatorName||"Unknown")+'</strong><small>'+esc(r.operatorEmail||"")+'</small></td>'+
        '<td>'+esc(r.sourceIp||"—")+'</td>'+
        '<td>'+esc(r.deviceName||"")+'</td>'+
        '<td>'+esc(r.locationName||"")+'</td>'+
        '<td>'+esc(r.action||r.eventType||"")+'</td>'+
        '<td>'+esc(r.webexStatus||"—")+'</td>'+
        '<td>'+esc(r.phonismStatus||"—")+'</td>'+
        '<td><span class="device-status '+statusClass(r.result)+'">'+esc(r.result||"Unknown")+'</span></td></tr>'
      ).join(""):'<tr><td colspan="9" class="device-empty">No device-management changes have been recorded yet.</td></tr>';
    }catch(error){
      if(body)body.innerHTML='<tr><td colspan="9" class="device-empty">History is not available: '+esc(error.message)+'</td></tr>';
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
    $("deviceWebexRegistrationFilter")?.addEventListener("change",applyFilters);
    $("devicePhonismRegistrationFilter")?.addEventListener("change",applyFilters);
    $("deviceLocationFilter")?.addEventListener("change",()=>void loadInventory(true));
    $("deviceClearFilters")?.addEventListener("click",()=>{
      $("deviceSearch").value="";$("deviceOwnerFilter").value="";$("deviceWebexRegistrationFilter").value="";$("devicePhonismRegistrationFilter").value="";applyFilters();
    });
    $("deviceRefresh")?.addEventListener("click",async()=>{await loadCapabilities();await loadLocations();await loadInventory(true);});
    $("deviceOperatorButton")?.addEventListener("click",()=>showOperatorDialog(null));
    $("deviceOperatorForm")?.addEventListener("submit",event=>void submitOperator(event));
    $("deviceOperatorClose")?.addEventListener("click",()=>{state.pendingOperatorAction=null;$("deviceOperatorDialog")?.close();});
    $("deviceOperatorCancel")?.addEventListener("click",()=>{state.pendingOperatorAction=null;$("deviceOperatorDialog")?.close();});
    $("deviceHistoryRefresh")?.addEventListener("click",()=>void loadHistory());
    $("devicePreviewChange")?.addEventListener("click",()=>void previewChange());
    $("deviceApplyChange")?.addEventListener("click",()=>void applyChange());
    $("deviceConfirmClose")?.addEventListener("click",()=>$("deviceConfirm")?.close());
    $("deviceConfirmCancel")?.addEventListener("click",()=>$("deviceConfirm")?.close());
    $("deviceRecoveryClose")?.addEventListener("click",()=>$("deviceRecovery")?.close());
    $("deviceRecoveryCancel")?.addEventListener("click",()=>$("deviceRecovery")?.close());
    $("deviceRecoveryConfirm")?.addEventListener("change",()=>{
      $("deviceFactoryReset").disabled=$("deviceRecoveryConfirm").checked!==true||!state.recovery;
    });
    $("deviceFactoryReset")?.addEventListener("click",()=>void factoryResetRecovery());
  }

  async function init(){
    bind();
    renderOperator();
    if(!await securityCheck())return;
    await restoreOperatorSession();
    await loadCapabilities();
    await loadLocations();
    await loadInventory(false);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else void init();
})();
