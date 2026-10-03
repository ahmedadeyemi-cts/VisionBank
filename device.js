(() => {
  "use strict";
  const SECURITY_BASE="https://visionbank-security.ahmedadeyemi.workers.dev";
  const API_BASE=SECURITY_BASE+"/api/webex/device-management";
  const OPERATOR_KEY="visionbankDeviceOperatorV2";
  const LEGACY_OPERATOR_KEY="visionbankDeviceOperatorV1";
  const POST_SAVE_KEY="visionbankDevicePostSaveV1";
  const READ_CACHE_PREFIX="visionbankDeviceReadCacheV2:";
  const CACHE_TTL={capabilities:90_000,locations:600_000,inventory:45_000};
  const state={capabilities:null,locations:[],devices:[],filtered:[],selected:null,members:[],memberLoadError:null,
    memberSearchTimer:null,memberSearchController:null,memberDetailController:null,memberSearchSeq:0,memberLoadedForDevice:null,memberLoadedAt:0,
    memberTotalMatches:0,memberEligibleMatches:0,memberUnavailableMatches:0,memberResultsTruncated:false,
    inventoryLocation:"",preview:null,recovery:null,operatorSession:null,pendingOperatorAction:null,postSave:null,
    identityPolicy:{verificationEnabled:true,adminAuthorized:false,admin:null},verificationChallenge:null,adminSettings:null};

  const $=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const text=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
  const normalize=value=>String(value??"").trim().toLowerCase();
  const lineStatus=line=>normalize(line?.registrationStatus||line?.status||"unknown");
  const statusClass=value=>{const s=normalize(value);return s.includes("register")&&!s.includes("unregister")?"registered":s.includes("unregister")||s.includes("failed")?"unregistered":s.includes("pending")||s.includes("connecting")?"pending":"unknown";};
  const registrationLabel=value=>{const s=normalize(value);if(s==="registered")return "Registered";if(s==="unregistered")return "Unregistered";if(s==="pending")return "Pending";if(s==="not-monitored")return "Not monitored";if(s==="connected")return "Connected";return "Unknown";};
  const syncClass=value=>{const s=normalize(value);return s==="in-sync"||s==="synced"?"registered":s.includes("mismatch")||s.includes("attention")?"mismatch":s.includes("pending")?"pending":"unknown";};

  function readCache(key,ttl){
    try{
      const raw=sessionStorage.getItem(READ_CACHE_PREFIX+key);
      if(!raw)return null;
      const entry=JSON.parse(raw);
      if(!entry?.savedAt||Date.now()-Number(entry.savedAt)>ttl)return null;
      return entry.data??null;
    }catch{return null;}
  }

  function writeCache(key,data){
    try{sessionStorage.setItem(READ_CACHE_PREFIX+key,JSON.stringify({savedAt:Date.now(),data}));}catch{}
  }

  function inventoryCacheKey(locationId){return "inventory:"+(locationId||"all");}

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
    const method=options.method||"GET",body=options.body,signal=options.signal;
    if(window.VB_SECURITY?.allowed!==true)throw new Error("Dashboard access is not approved.");
    const sessionId=state.operatorSession?.sessionId||"";
    let securitySession="";try{securitySession=localStorage.getItem("vb_session")||"";}catch{}
    const res=await fetch(API_BASE+path,{
      method,mode:"cors",credentials:"omit",cache:"no-store",
      headers:{Accept:"application/json",
        ...(sessionId?{"X-VB-Operator-Session":sessionId}:{}),
        ...(securitySession?{Authorization:"Bearer "+securitySession}:{}),
        ...(body!==undefined?{"Content-Type":"application/json"}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),
      ...(signal?{signal}:{})
    });
    let data={};try{data=await res.json();}catch{}
    if(!res.ok||data.success===false){
      const code=data.error||null;
      const e=new Error(code||data.message||("HTTP "+res.status));
      e.code=code;e.status=res.status;e.details=data;throw e;
    }
    return data;
  }

  function friendlyDeviceError(error){
    const code=error?.code||error?.message||"";
    if(code==="target-appearance-limit"){
      const target=error?.details?.target||{};
      const appearances=Array.isArray(error?.details?.appearances)?error.details.appearances:[];
      const label=[target.name,target.extension].filter(Boolean).join(" · ")||"This extension";
      if(appearances.length){
        const phones=appearances.map(a=>{
          const device=[a.deviceName,a.model].filter(Boolean).join(" · ");
          const owner=a.ownerName?(" — primary owner "+a.ownerName+(a.ownerExtension?" "+a.ownerExtension:"")):"";
          const port=a.port?(" — line "+a.port):"";
          const mac=a.mac?(" — "+a.mac):"";
          return device+owner+port+mac;
        }).join("; ");
        return label+" has reached its Webex shared-line appearance limit. Existing appearance"+(appearances.length===1?"":"s")+": "+phones+". Remove an appearance or choose another extension.";
      }
      return label+" has reached its Webex shared-line appearance limit. Choose another line or free an appearance in Control Hub.";
    }
    const messages={
      "target-appearance-limit":"This extension has reached its Webex shared-line appearance limit. Choose another line or free an appearance in Control Hub.",
      "partner-managed-line-label-unsupported":"Webex rejected a line-label setting that is not supported on this partner-managed phone. Refresh and retry.",
      "device-state-changed-review-again":"The device changed after review. Refresh the device and review the change again.",
      "webex-members-conflict":"Webex reports that the device membership changed. Refresh and review the change again.",
      "webex-members-write-failed":"Webex rejected the line assignment. Choose another line or refresh and try again.",
      "phonism-write-failed":"Webex could not complete the Save & Sync transaction because Phonism Sync was not accepted. Any partial Webex change was rolled back.",
      "operator-verification-required":"Verify your work email before making device changes.",
      "verification-challenge-expired":"That verification code expired. Request a new code.",
      "verification-code-invalid":"The verification code is not correct.",
      "verification-attempts-exceeded":"Too many incorrect attempts. Request a new verification code.",
      "verification-resend-too-soon":"A code was just sent. Wait a moment before requesting another.",
      "verification-rate-limited":"Too many verification codes were requested. Try again later.",
      "verification-source-changed":"The verification request came from a different network address. Request a new code.",
      "device-admin-session-required":"Sign in to VisionBank Security with an authorized Device Manager admin account.",
      "device-admin-self-remove-denied":"You cannot remove the admin identity you are currently using.",
      "device-individual-admin-required":"At least one individual admin must remain. The shared Tech Admin mailbox cannot be the only admin.",
      "device-admin-email-invalid":"Enter a valid admin email address."
    };
    return messages[code]||("Save & Sync was not completed: "+code);
  }

  function renderOperator(){
    const session=state.operatorSession,operator=session?.operator;
    text("deviceOperatorName",operator?.name||"Not identified");
    text("deviceOperatorEmail",operator?.email||"Required before changes");
    text("deviceOperatorButton",operator?"Change Operator":"Identify Operator");
    const verification=$("deviceOperatorVerification");
    if(verification){
      const required=state.identityPolicy?.verificationEnabled!==false;
      const until=session?.verified===true&&session?.expiresAt?new Date(session.expiresAt).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"";
      verification.textContent=!operator?"Verification pending":session?.verified===true?("Email verified"+(until?" · "+until:"")):required?"Email verification required":"Verification not required";
      verification.className="device-operator-verification "+(session?.verified===true?"verified":operator&&!required?"disabled":"pending");
    }
    const chip=$("deviceOperatorChip");if(chip)chip.classList.toggle("identified",Boolean(operator));
    const adminButton=$("deviceAdminButton");if(adminButton)adminButton.hidden=state.identityPolicy?.adminAuthorized!==true;
    const signOut=$("deviceSignOutButton");if(signOut)signOut.hidden=!operator;
  }

  function saveOperatorSession(session){
    state.operatorSession=session||null;
    try{
      sessionStorage.removeItem(OPERATOR_KEY);
      sessionStorage.removeItem(LEGACY_OPERATOR_KEY);
      localStorage.removeItem(OPERATOR_KEY);
      if(session){
        const serialized=JSON.stringify(session);
        if(session.verified===true)localStorage.setItem(OPERATOR_KEY,serialized);
        else sessionStorage.setItem(OPERATOR_KEY,serialized);
      }
    }catch{}
    renderOperator();
  }

  async function loadIdentityPolicy(){
    try{
      const data=await api("/identity-policy");
      state.identityPolicy={verificationEnabled:data.verificationEnabled!==false,adminAuthorized:data.adminAuthorized===true,admin:data.admin||null};
      if(state.identityPolicy.verificationEnabled&&state.operatorSession&&state.operatorSession.verified!==true)saveOperatorSession(null);
      renderOperator();
      return data;
    }catch(error){
      state.identityPolicy={verificationEnabled:true,adminAuthorized:false,admin:null};
      renderOperator();
      console.debug("Identity policy unavailable:",error.message);
      return null;
    }
  }

  async function restoreOperatorSession(){
    let saved=null;
    try{
      saved=JSON.parse(localStorage.getItem(OPERATOR_KEY)||sessionStorage.getItem(OPERATOR_KEY)||sessionStorage.getItem(LEGACY_OPERATOR_KEY)||"null");
    }catch{}
    if(!saved?.sessionId){renderOperator();return;}
    state.operatorSession=saved;
    try{
      const data=await api("/operator-session");
      saveOperatorSession({sessionId:data.sessionId,operator:data.operator,verified:data.verified===true,
        verificationMethod:data.verificationMethod||"none",verifiedAt:data.verifiedAt||null,sessionHours:data.sessionHours||null,
        startedAt:data.startedAt,expiresAt:data.expiresAt});
      await loadIdentityPolicy();
    }catch{
      saveOperatorSession(null);
    }
  }

  function resetVerificationStep(){
    state.verificationChallenge=null;
    const panel=$("deviceVerificationPanel"),code=$("deviceVerificationCode");
    if(panel)panel.hidden=true;
    if(code)code.value="";
    const name=$("deviceOperatorFullName"),email=$("deviceOperatorWorkEmail");
    if(name)name.disabled=false;if(email)email.disabled=false;
    text("deviceOperatorSave",state.identityPolicy?.verificationEnabled!==false?"Send Verification Code":"Continue");
  }

  function showOperatorDialog(pendingAction=null){
    state.pendingOperatorAction=pendingAction;
    const operator=state.operatorSession?.operator||{};
    const name=$("deviceOperatorFullName"),email=$("deviceOperatorWorkEmail");
    if(name)name.value=operator.name||"";
    if(email)email.value=operator.email||"";
    resetVerificationStep();
    text("deviceOperatorMessage",state.identityPolicy?.verificationEnabled!==false?
      "Enter your work email. A six-digit verification code will be emailed before device changes are allowed.":
      "Email verification is currently disabled by a Device Manager admin. Your identity is still recorded for auditing.");
    $("deviceOperatorDialog")?.showModal();
    setTimeout(()=>name?.focus(),0);
  }

  async function finishOperatorSession(data){
    saveOperatorSession({sessionId:data.sessionId,operator:data.operator,verified:data.verified===true,
      verificationMethod:data.verificationMethod||"none",verifiedAt:data.verifiedAt||null,sessionHours:data.sessionHours||null,
      startedAt:data.startedAt,expiresAt:data.expiresAt});
    await loadIdentityPolicy();
    $("deviceOperatorDialog")?.close();
    const pending=state.pendingOperatorAction;state.pendingOperatorAction=null;
    if(pending?.type==="edit"&&pending.id)await openEditor(pending.id);
  }

  async function signOutOperator(){
    const button=$("deviceSignOutButton");if(button)button.disabled=true;
    try{if(state.operatorSession?.sessionId)await api("/operator-session/logout",{method:"POST",body:{}});}
    catch(error){console.debug("Device Manager sign out cleanup:",error.message);}
    finally{
      saveOperatorSession(null);
      state.identityPolicy={...state.identityPolicy,adminAuthorized:false,admin:null};
      state.adminSettings=null;
      renderOperator();
      if(button)button.disabled=false;
    }
  }

  async function sendVerificationCode(){
    const name=$("deviceOperatorFullName")?.value||"",email=$("deviceOperatorWorkEmail")?.value||"";
    const data=await api("/verification-request",{method:"POST",body:{name,email}});
    if(data.required===false){
      const session=await api("/operator-session",{method:"POST",body:{name,email}});
      await finishOperatorSession(session);return;
    }
    state.verificationChallenge={challengeId:data.challengeId,emailMasked:data.emailMasked,expiresAt:data.expiresAt};
    const panel=$("deviceVerificationPanel"),nameEl=$("deviceOperatorFullName"),emailEl=$("deviceOperatorWorkEmail"),code=$("deviceVerificationCode");
    if(panel)panel.hidden=false;if(nameEl)nameEl.disabled=true;if(emailEl)emailEl.disabled=true;
    text("deviceVerificationHint","Code sent to "+(data.emailMasked||"your work email")+" · expires in 10 minutes");
    text("deviceOperatorMessage","Enter the six-digit code to verify this operator.");
    text("deviceOperatorSave","Verify Code");
    setTimeout(()=>code?.focus(),0);
  }

  async function submitOperator(event){
    event.preventDefault();
    const button=$("deviceOperatorSave");if(button)button.disabled=true;
    try{
      if(state.verificationChallenge){
        const code=$("deviceVerificationCode")?.value||"";
        const data=await api("/verification-confirm",{method:"POST",body:{challengeId:state.verificationChallenge.challengeId,code}});
        await finishOperatorSession(data);
      }else if(state.identityPolicy?.verificationEnabled!==false){
        await sendVerificationCode();
      }else{
        const name=$("deviceOperatorFullName")?.value||"",email=$("deviceOperatorWorkEmail")?.value||"";
        const data=await api("/operator-session",{method:"POST",body:{name,email}});
        await finishOperatorSession(data);
      }
    }catch(error){
      text("deviceOperatorMessage",friendlyDeviceError(error));
    }finally{if(button)button.disabled=false;}
  }

  async function resendVerificationCode(){
    const button=$("deviceVerificationResend");if(button)button.disabled=true;
    state.verificationChallenge=null;
    const name=$("deviceOperatorFullName"),email=$("deviceOperatorWorkEmail");
    if(name)name.disabled=false;if(email)email.disabled=false;
    try{await sendVerificationCode();}
    catch(error){text("deviceOperatorMessage",friendlyDeviceError(error));}
    finally{if(button)button.disabled=false;}
  }

  function renderAdminSettings(){
    const settings=state.adminSettings||{};
    const toggle=$("deviceVerificationToggle"),label=$("deviceVerificationToggleLabel");
    if(toggle)toggle.checked=settings.verificationEnabled!==false;
    if(label)label.textContent=settings.verificationEnabled!==false?"On":"Off";

    const defaultHours=$("deviceDefaultVerificationHours");
    if(defaultHours)defaultHours.value=String(settings.defaultVerificationHours||24);

    const overrides=settings.verificationHoursByEmail&&typeof settings.verificationHoursByEmail==="object"?
      settings.verificationHoursByEmail:{};
    const durationList=$("deviceDurationOverrideList");
    if(durationList){
      const rows=Object.entries(overrides).sort(([a],[b])=>a.localeCompare(b));
      durationList.innerHTML=rows.length?rows.map(([mail,value])=>
        '<div class="device-admin-row"><div><strong>'+esc(mail)+'</strong>'+
        '<span class="device-admin-meta">'+esc(value)+' hour'+(Number(value)===1?'':'s')+' before re-verification</span></div>'+
        '<button class="device-link-btn" type="button" data-duration-remove="'+esc(mail)+'">Use Default</button></div>'
      ).join(""):'<div class="device-member-empty">No per-user duration overrides. Everyone uses the default.</div>';
      durationList.querySelectorAll("[data-duration-remove]").forEach(btn=>btn.addEventListener("click",()=>void removeUserDuration(btn.dataset.durationRemove||"")));
    }

    const list=$("deviceAdminList");
    if(list){
      const shared=new Set(Array.isArray(settings.sharedMailboxes)?settings.sharedMailboxes:[]);
      const current=settings.currentAdmin?.email||"";
      const admins=Array.isArray(settings.admins)?settings.admins:[];
      list.innerHTML=admins.length?admins.map(mail=>{
        const isShared=shared.has(mail),isCurrent=mail===current;
        return '<div class="device-admin-row"><div><strong>'+esc(mail)+'</strong>'+
          '<span class="device-admin-meta">'+(isShared?'Shared Tech Admin mailbox':'Individual admin')+(isCurrent?' · Current admin':'')+'</span></div>'+
          '<button class="device-link-btn device-admin-remove" type="button" data-admin-remove="'+esc(mail)+'" '+(isCurrent?'disabled':'')+'>Remove</button></div>';
      }).join(""):'<div class="device-member-empty">No Device Manager admins are configured.</div>';
      list.querySelectorAll("[data-admin-remove]").forEach(btn=>btn.addEventListener("click",()=>void removeAdmin(btn.dataset.adminRemove||"")));
    }
    text("deviceAdminMessage",settings.updatedAt?
      "Last updated "+new Date(settings.updatedAt).toLocaleString()+" by "+(settings.updatedBy||"an admin")+".":"Initial Device Manager admin policy.");
  }

  async function loadAdminSettings(){
    const data=await api("/admin-settings");
    state.adminSettings=data;
    renderAdminSettings();
    return data;
  }

  async function openAdminSettings(){
    try{
      await loadAdminSettings();
      $("deviceAdminDialog")?.showModal();
    }catch(error){
      if(error.code==="device-admin-session-required"){
        state.identityPolicy={...state.identityPolicy,adminAuthorized:false,admin:null};renderOperator();
        alert("Verify an email that is on the Device Manager admin list, or sign in to VisionBank Security with an authorized admin account.");
      }else alert("Admin settings are not available: "+error.message);
    }
  }

  async function updateVerificationSetting(){
    const toggle=$("deviceVerificationToggle");if(!toggle)return;
    const previous=state.adminSettings?.verificationEnabled!==false;
    toggle.disabled=true;
    try{
      const data=await api("/admin-settings/verification",{method:"POST",body:{enabled:toggle.checked}});
      state.adminSettings={...state.adminSettings,...data};
      state.identityPolicy={...state.identityPolicy,verificationEnabled:data.verificationEnabled!==false};
      if(state.identityPolicy.verificationEnabled&&state.operatorSession?.verified!==true)saveOperatorSession(null);
      renderAdminSettings();renderOperator();
    }catch(error){
      toggle.checked=previous;
      text("deviceAdminMessage","Unable to change verification: "+friendlyDeviceError(error));
    }finally{toggle.disabled=false;}
  }

  async function updateDefaultVerificationHours(){
    const input=$("deviceDefaultVerificationHours"),button=$("deviceDefaultVerificationSave");
    const value=Number(input?.value||24);
    if(!Number.isFinite(value)||value<1||value>720){text("deviceAdminMessage","Default verification duration must be between 1 and 720 hours.");return;}
    if(button)button.disabled=true;
    try{
      const data=await api("/admin-settings/default-hours",{method:"POST",body:{hours:value}});
      state.adminSettings={...state.adminSettings,...data};
      renderAdminSettings();
    }catch(error){text("deviceAdminMessage","Unable to save default duration: "+friendlyDeviceError(error));}
    finally{if(button)button.disabled=false;}
  }

  async function setUserDuration(){
    const emailInput=$("deviceDurationEmailInput"),hoursInput=$("deviceDurationHoursInput"),button=$("deviceDurationSaveButton");
    const mail=emailInput?.value?.trim()||"",value=Number(hoursInput?.value||0);
    if(!mail){text("deviceAdminMessage","Enter the user email for the duration override.");return;}
    if(!Number.isFinite(value)||value<1||value>720){text("deviceAdminMessage","User verification duration must be between 1 and 720 hours.");return;}
    if(button)button.disabled=true;
    try{
      const data=await api("/admin-settings/durations/set",{method:"POST",body:{email:mail,hours:value}});
      state.adminSettings={...state.adminSettings,...data};
      if(emailInput)emailInput.value="";if(hoursInput)hoursInput.value="";
      renderAdminSettings();
    }catch(error){text("deviceAdminMessage","Unable to set user duration: "+friendlyDeviceError(error));}
    finally{if(button)button.disabled=false;}
  }

  async function removeUserDuration(mail){
    if(!mail)return;
    try{
      const data=await api("/admin-settings/durations/remove",{method:"POST",body:{email:mail}});
      state.adminSettings={...state.adminSettings,...data};
      renderAdminSettings();
    }catch(error){text("deviceAdminMessage","Unable to remove user duration: "+friendlyDeviceError(error));}
  }

  async function addAdmin(){
    const input=$("deviceAdminEmailInput"),button=$("deviceAdminAddButton");
    const mail=input?.value?.trim()||"";
    if(!mail)return;
    if(button)button.disabled=true;
    try{
      const data=await api("/admin-settings/admins/add",{method:"POST",body:{email:mail}});
      state.adminSettings={...state.adminSettings,...data};
      if(input)input.value="";
      renderAdminSettings();
    }catch(error){text("deviceAdminMessage","Unable to add admin: "+friendlyDeviceError(error));}
    finally{if(button)button.disabled=false;}
  }

  async function removeAdmin(mail){
    if(!mail||!confirm("Remove "+mail+" from Device Manager admins?"))return;
    try{
      const data=await api("/admin-settings/admins/remove",{method:"POST",body:{email:mail}});
      state.adminSettings={...state.adminSettings,...data};
      renderAdminSettings();
      await loadIdentityPolicy();
    }catch(error){text("deviceAdminMessage","Unable to remove admin: "+friendlyDeviceError(error));}
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
    text("deviceWebexHealth",webex.ready?"Connected":webex.detected?"Attention":"Unavailable");
    text("devicePhonismHealth",phonism.ready?"Connected":phonism.detected?"Attention":"Unavailable");
    text("deviceWriteHealth",writes.enabled?(writes.organizationWide?"Enabled · all VisionBank phones":"Enabled"):writes.previewReady?"Review only":"Read-only");
    text("deviceHealthWebexText",webex.detail||webex.message||"Webex capability check pending.");
    text("deviceHealthPhonismText",phonism.detail||phonism.message||"Phonism capability check pending.");
    renderCheckList("deviceHealthWebexChecks",webex.checks||[]);
    renderCheckList("deviceHealthPhonismChecks",phonism.checks||[]);
  }

  function applyLocationsData(data){
    state.locations=Array.isArray(data?.locations)?data.locations:[];
    const select=$("deviceLocationFilter");if(!select)return;
    const current=select.value;
    select.innerHTML='<option value="">All VisionBank locations</option>'+state.locations.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.name||"Location")+'</option>').join("");
    if([...select.options].some(o=>o.value===current))select.value=current;
  }

  function applyInventoryData(data,{cached=false}={}){
    state.devices=Array.isArray(data?.devices)?data.devices:[];
    text("deviceSyncStamp",cached?"Recent inventory · refreshing…":data?.generatedAt?("Updated "+new Date(data.generatedAt).toLocaleTimeString()):"Inventory updated");
    applyFilters();
    const message=cached?"Showing recent inventory while live data refreshes…":
      data?.message||(data?.summaryOnly?("Showing "+state.devices.length+" VisionBank phones. Select a location for line details."):
        ("Loaded "+state.devices.length+" phones with detailed provider data."));
    text("deviceInventoryStatus",message);
  }

  function hydrateReadCache(){
    const capabilities=readCache("capabilities",CACHE_TTL.capabilities);if(capabilities)setCapabilities(capabilities);
    const locations=readCache("locations",CACHE_TTL.locations);if(locations)applyLocationsData(locations);
    const inventory=readCache(inventoryCacheKey(""),CACHE_TTL.inventory);if(inventory)applyInventoryData(inventory,{cached:true});
  }

  async function loadCapabilities(){
    try{
      const data=await api("/capabilities");
      setCapabilities(data);
      writeCache("capabilities",data);
      return data;
    }catch(error){
      if(state.capabilities)return state.capabilities;
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
      applyLocationsData(data);
      writeCache("locations",data);
      return data;
    }catch(error){
      if(!state.locations.length)state.locations=[];
      if(error.status!==404)console.debug("Location inventory unavailable:",error.message);
      return null;
    }
  }

  async function loadInventory(force=false){
    const body=$("deviceInventoryRows");
    const locationId=$("deviceLocationFilter")?.value||"";
    const cacheKey=inventoryCacheKey(locationId);
    const sameScope=state.inventoryLocation===locationId;
    const cached=!force?readCache(cacheKey,CACHE_TTL.inventory):null;

    if(cached){
      applyInventoryData(cached,{cached:true});
      state.inventoryLocation=locationId;
    }else{
      text("deviceInventoryStatus",locationId?"Loading detailed phone and line assignments…":"Loading VisionBank Iowa phone inventory…");
      if(body&&(!state.devices.length||!sameScope)){
        body.innerHTML='<tr><td colspan="9" class="device-empty"><div class="device-loading-line"></div><div class="device-loading-line" style="margin-top:10px;width:72%"></div></td></tr>';
      }
    }

    try{
      const q=new URLSearchParams();
      if(locationId)q.set("locationId",locationId);
      if(force)q.set("refresh","1");
      const data=await api("/inventory"+(q.size?"?"+q.toString():""));
      state.inventoryLocation=locationId;
      applyInventoryData(data);
      writeCache(cacheKey,data);
      return data;
    }catch(error){
      if(state.devices.length&&(cached||sameScope)){
        text("deviceInventoryStatus","Live refresh is delayed. Showing the most recent inventory available.");
        return null;
      }
      state.devices=[];state.filtered=[];
      if(body)body.innerHTML='<tr><td colspan="9" class="device-empty">Device inventory could not be loaded. '+esc(error.status===404?"Backend integration is being prepared.":error.message)+'</td></tr>';
      text("deviceInventoryStatus","No live inventory has been loaded.");
      renderKpis();
      return null;
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
    const when=new Date(lease.expiresAt),remaining=when.getTime()-Date.now();
    const label=Number.isNaN(when.getTime())?lease.expiresAt:when.toLocaleString();
    const minutes=Math.max(0,Math.ceil(remaining/60_000));
    const countdown=minutes>=60?(Math.floor(minutes/60)+"h "+(minutes%60)+"m"):(minutes+"m");
    return '<span class="device-status pending">Temporary · '+esc(countdown)+'</span><small>Restores '+esc(label)+'</small>';
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
      '<td>'+(d.detailsLoaded===false?'<button class="device-row-action" type="button" data-device-summary="'+esc(d.phonismPhoneId||"")+'">Manage Device</button>':'<button class="device-row-action" type="button" data-device-edit="'+esc(d.id)+'">Manage Device</button>')+'</td></tr>').join("");
    body.querySelectorAll("[data-device-edit]").forEach(btn=>btn.addEventListener("click",()=>openEditor(btn.dataset.deviceEdit)));
    body.querySelectorAll("[data-device-summary]").forEach(btn=>btn.addEventListener("click",()=>void loadSummaryDevice(btn)));
  }

  async function refreshDeviceDetail(locationId,phonismPhoneId){
    const q=new URLSearchParams({locationId:String(locationId||""),phonismPhoneId:String(phonismPhoneId||"")});
    const data=await api("/device-detail?"+q.toString());
    const detailed=data.device;
    const index=state.devices.findIndex(d=>String(d.phonismPhoneId||"")===String(phonismPhoneId));
    if(index>=0)state.devices[index]=detailed;
    else state.devices.unshift(detailed);
    applyFilters();
    return detailed;
  }

  async function loadSummaryDevice(button){
    const phonismPhoneId=button?.dataset?.deviceSummary||"";
    const summary=state.devices.find(d=>String(d.phonismPhoneId||"")===String(phonismPhoneId));
    if(!summary?.locationId||!phonismPhoneId)return;
    const original=button.textContent;
    button.disabled=true;button.textContent="Loading device details…";
    text("deviceInventoryStatus","Loading "+(summary.displayName||"device")+" from Webex and Phonism…");
    try{
      const detailed=await refreshDeviceDetail(summary.locationId,phonismPhoneId);
      text("deviceInventoryStatus","Device details loaded.");
      await openEditor(detailed.id);
    }catch(error){
      text("deviceInventoryStatus","Unable to load device details: "+friendlyDeviceError(error));
      if(button.isConnected){button.disabled=false;button.textContent=original;}
    }
  }

  function memberKind(member){
    return member?.type==="PLACE"?"Workspace":"User";
  }

  function selectedMember(){
    const id=$("deviceLine2Select")?.value||"";
    return state.members.find(x=>String(x.id)===String(id))||null;
  }

  function memberOptionDisabled(id){
    const select=$("deviceLine2Select");
    const option=select?[...select.options].find(o=>String(o.value)===String(id)):null;
    return option?.disabled===true;
  }

  function renderMemberPickerValue(){
    const member=selectedMember();
    const value=$("deviceLine2PickerValue");
    if(!value)return;
    if(!member){value.textContent="None";return;}
    value.textContent=[member.name||"Member",member.extension||member.phoneNumber||"",member.locationName||""].filter(Boolean).join(" · ");
  }

  function unavailableMemberDetail(member){
    const appearances=Array.isArray(member?.appearances)?member.appearances:[];
    if(appearances.length){
      const a=appearances[0]||{};
      const device=[a.deviceName,a.model].filter(Boolean).join(" · ")||"another phone";
      const owner=a.ownerName?(" · Primary "+a.ownerName+(a.ownerExtension?" "+a.ownerExtension:"")):"";
      const line=a.port?(" · Line "+a.port):"";
      const mac=a.mac?(" · "+a.mac):"";
      const more=appearances.length>1?(" · +"+(appearances.length-1)+" more appearance"+(appearances.length===2?"":"s")):"";
      return "Webex appearance limit · Existing: "+device+owner+line+mac+more;
    }
    return "Webex is not offering another shared-line appearance for this line.";
  }

  function renderMemberSearchResults(){
    const host=$("deviceLine2Results");if(!host)return;
    const query=normalize($("deviceLine2Search")?.value||"");
    const selectedId=$("deviceLine2Select")?.value||"";
    const filtered=state.members;
    const noneSelected=!selectedId;
    let html='<button class="device-member-option none" type="button" data-member-choice="" role="option" aria-selected="'+(noneSelected?"true":"false")+'"><strong>None — remove temporary Line 2</strong></button>';
    if(filtered.length){
      html+=filtered.map(m=>{
        const unavailable=m.available===false;
        const disabled=unavailable||memberOptionDisabled(m.id);
        const label=[memberKind(m),m.locationName||"Location unavailable",m.phoneNumber||""].filter(Boolean).join(" · ");
        const detail=unavailable?unavailableMemberDetail(m):label;
        return '<button class="device-member-option'+(unavailable?' unavailable':'')+'" type="button" data-member-choice="'+esc(m.id)+'" role="option" aria-selected="'+(String(selectedId)===String(m.id)?"true":"false")+'" '+(disabled?"disabled aria-disabled=\"true\"":"")+'>'+
          '<strong>'+esc(m.name||"Member")+'</strong><span class="device-member-ext">'+esc(m.extension||m.phoneNumber||"No extension")+'</span>'+
          '<span class="device-member-state '+(unavailable?'unavailable':'available')+'">'+(unavailable?'Unavailable':'Available')+'</span>'+
          '<small>'+esc(detail)+'</small></button>';
      }).join("");
    }else{
      html+='<div class="device-member-empty">No users or workspaces match this search.</div>';
    }
    if(state.memberResultsTruncated){
      html+='<div class="device-member-empty">Showing a limited result set'+(state.memberTotalMatches?(' from '+esc(state.memberTotalMatches)+' matches'):'')+
        '. Refine '+(query?'your search':'by name, extension, number, workspace, or location')+' to narrow the list.</div>';
    }
    host.innerHTML=html;
    const choices=[...host.querySelectorAll("[data-member-choice]")];
    choices.forEach((btn,index)=>{
      btn.addEventListener("click",()=>{
        if(btn.disabled)return;
        chooseMember(btn.dataset.memberChoice||"");
      });
      btn.addEventListener("keydown",event=>{
        if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
        event.preventDefault();
        const enabled=choices.filter(choice=>!choice.disabled);
        if(!enabled.length)return;
        const current=enabled.indexOf(btn);
        const next=event.key==="Home"?enabled[0]:event.key==="End"?enabled.at(-1):
          event.key==="ArrowDown"?enabled[(Math.max(current,0)+1)%enabled.length]:
          enabled[(Math.max(current,0)-1+enabled.length)%enabled.length];
        next?.focus();
      });
    });
  }

  function openMemberPicker(){
    const button=$("deviceLine2PickerButton"),panel=$("deviceLine2PickerPanel"),search=$("deviceLine2Search");
    if(!button||button.disabled||!panel)return;
    panel.hidden=false;button.setAttribute("aria-expanded","true");
    if(search){search.value="";setTimeout(()=>search.focus(),0);}
    const hasFreshDefault=state.selected&&state.memberLoadedForDevice===String(state.selected.id||"")&&Date.now()-state.memberLoadedAt<30_000;
    if(hasFreshDefault)renderMemberSearchResults();
    else if(state.selected)void searchMembers(state.selected,"");
    else renderMemberSearchResults();
  }

  function closeMemberPicker(){
    const button=$("deviceLine2PickerButton"),panel=$("deviceLine2PickerPanel");
    if(panel)panel.hidden=true;
    if(button)button.setAttribute("aria-expanded","false");
  }

  function chooseMember(id){
    const select=$("deviceLine2Select");
    if(!select)return;
    const option=[...select.options].find(o=>String(o.value)===String(id));
    if(option?.disabled)return;
    select.value=id;
    renderMemberPickerValue();
    closeMemberPicker();
    renderCandidate();
  }

  function currentLine2Member(device){
    const currentId=device?.line2?.memberId||device?.line2?.id||"";
    return currentId?{
      id:currentId,name:device.line2?.name||"Current Line 2",type:device.line2?.type||"PEOPLE",
      extension:device.line2?.extension||"",phoneNumber:device.line2?.phoneNumber||"",
      locationId:device.line2?.locationId||device.locationId||null,
      locationName:device.line2?.locationName||device.locationName||"",
      currentAssignment:true
    }:null;
  }

  function populateMemberOptions(selectedId=""){
    const select=$("deviceLine2Select");
    if(!select)return;
    select.disabled=false;
    select.innerHTML='<option value="">None</option>'+state.members.map(m=>
      '<option value="'+esc(m.id)+'" '+(m.available===false?'disabled':'')+'>'+esc(m.name||"Member")+' · '+esc(m.extension||m.phoneNumber||"No extension")+' · '+esc(memberKind(m))+' · '+esc(m.locationName||"Location unavailable")+(m.available===false?' · Unavailable':'')+'</option>'
    ).join("");
    if(selectedId&&state.members.some(m=>String(m.id)===String(selectedId)))select.value=selectedId;
  }

  async function enrichUnavailableMemberDetails(device,query,seq){
    state.memberDetailController?.abort();
    const controller=new AbortController();
    state.memberDetailController=controller;
    try{
      const q=new URLSearchParams({deviceId:String(device.id||""),q:String(query||""),limit:"50",details:"1"});
      const data=await api("/members?"+q.toString(),{signal:controller.signal});
      if(seq!==state.memberSearchSeq)return;
      const detailed=new Map((Array.isArray(data.members)?data.members:[]).map(row=>[String(row.id),row]));
      state.members=state.members.map(row=>{
        const replacement=detailed.get(String(row.id));
        return row.available===false&&replacement?replacement:row;
      });
      renderMemberSearchResults();
    }catch(error){
      if(error?.name!=="AbortError"&&seq===state.memberSearchSeq)console.debug("Member availability detail delayed:",error.message);
    }finally{
      if(state.memberDetailController===controller)state.memberDetailController=null;
    }
  }

  async function searchMembers(device,query="",{initial=false}={}){
    const seq=++state.memberSearchSeq;
    state.memberSearchController?.abort();
    state.memberDetailController?.abort();
    const controller=new AbortController();
    state.memberSearchController=controller;
    const select=$("deviceLine2Select"),picker=$("deviceLine2PickerButton");
    const current=currentLine2Member(device);
    const selectedId=initial?(current?.id||""):String(select?.value??current?.id??"");
    const preserved=selectedId?(state.members.find(m=>String(m.id)===String(selectedId))||
      (String(current?.id||"")===String(selectedId)?current:null)):null;
    if(initial){
      if(select){select.disabled=true;select.innerHTML='<option value="">Loading eligible lines…</option>';}
      if(picker){picker.disabled=true;text("deviceLine2PickerValue","Loading available users & workspaces…");}
    }
    try{
      const q=new URLSearchParams({deviceId:String(device.id||""),limit:"50"});
      const cleanQuery=String(query||"").trim();
      if(cleanQuery)q.set("q",cleanQuery);
      const data=await api("/members?"+q.toString(),{signal:controller.signal});
      if(seq!==state.memberSearchSeq)return;
      const rows=Array.isArray(data.members)?data.members:[];
      if(preserved&&!rows.some(m=>String(m.id)===String(preserved.id)))rows.unshift(preserved);
      state.members=rows;
      state.memberTotalMatches=Number.isFinite(Number(data.totalMatches))?Number(data.totalMatches):rows.length;
      state.memberEligibleMatches=Number.isFinite(Number(data.eligibleMatches))?Number(data.eligibleMatches):rows.filter(m=>m.available!==false).length;
      state.memberUnavailableMatches=Number.isFinite(Number(data.unavailableMatches))?Number(data.unavailableMatches):rows.filter(m=>m.available===false).length;
      state.memberResultsTruncated=Boolean(data.truncated);
      state.memberLoadError=null;
      if(!cleanQuery){state.memberLoadedForDevice=String(device.id||"");state.memberLoadedAt=Date.now();}
      populateMemberOptions(selectedId);
      if(picker)picker.disabled=false;
      renderMemberPickerValue();
      renderMemberSearchResults();
      if(cleanQuery&&data.detailsPending)void enrichUnavailableMemberDetails(device,cleanQuery,seq);
      if(selectedId)renderCandidate();
      else if(state.memberTotalMatches){
        if(cleanQuery&&state.memberUnavailableMatches){
          text("deviceLine2CandidateMeta",
            state.memberEligibleMatches+" eligible · "+state.memberUnavailableMatches+
            " found but unavailable in Webex.");
        }else{
          const matches=state.memberTotalMatches===1?"matches":"match";
          text("deviceLine2CandidateMeta",state.memberTotalMatches+" eligible organization-wide line"+(state.memberTotalMatches===1?"":"s")+" "+
            (cleanQuery?(matches+" this search"):"available across VisionBank Webex")+(state.memberResultsTruncated?". Refine the search to narrow the list.":"."));
        }
      }else text("deviceLine2CandidateMeta","No users or workspaces match this search.");
    }catch(error){
      if(error?.name==="AbortError"||seq!==state.memberSearchSeq)return;
      if(initial){
        state.memberLoadError=error.message||"member-search-failed";
        if(select){select.disabled=true;select.innerHTML='<option value="">Unable to load available lines</option>';}
        if(picker){picker.disabled=true;text("deviceLine2PickerValue","Unable to load available lines");}
        text("deviceLine2CandidateMeta","Unable to load available lines: "+state.memberLoadError);
      }else{
        const host=$("deviceLine2Results");
        if(host)host.innerHTML='<div class="device-member-empty">Search is temporarily unavailable. Try again.</div>';
      }
      if(error.status!==404)console.debug("Member search unavailable:",error.message);
    }finally{
      if(state.memberSearchController===controller)state.memberSearchController=null;
    }
  }

  async function loadMembers(device){
    state.members=[];state.memberLoadError=null;state.memberLoadedForDevice=null;state.memberLoadedAt=0;
    state.memberTotalMatches=0;state.memberEligibleMatches=0;state.memberUnavailableMatches=0;state.memberResultsTruncated=false;
    closeMemberPicker();
    text("deviceLine2CandidateMeta","Loading eligible users and workspaces across VisionBank Webex…");
    await searchMembers(device,"",{initial:true});
  }

  function scheduleMemberSearch(){
    clearTimeout(state.memberSearchTimer);
    const query=$("deviceLine2Search")?.value||"";
    const host=$("deviceLine2Results");
    if(host)host.innerHTML='<div class="device-member-empty">Searching VisionBank users and workspaces…</div>';
    state.memberSearchTimer=setTimeout(()=>{if(state.selected)void searchMembers(state.selected,query);},250);
  }

  function renderLeaseExpiryPreview(){
    const minutes=Number($("deviceLeaseDuration")?.value||60);
    const when=new Date(Date.now()+minutes*60_000);
    let label;
    try{
      label=new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(when);
    }catch{label=when.toLocaleString();}
    text("deviceLeaseExpiryPreview",label+" (estimated)");
  }

  function updateEditorActionState(device,{loading=false}={}){
    const reviewEnabled=!loading&&state.capabilities?.writes?.previewReady===true&&device?.writeEligible===true;
    const saveEnabled=state.capabilities?.writes?.enabled===true&&device?.writeEligible===true;
    const orgWide=state.capabilities?.writes?.scope==="organization";
    const button=$("devicePreviewChange");
    if(button)button.disabled=!reviewEnabled||Boolean(state.memberLoadError);
    text("deviceEditorWarning",loading?"Loading eligible Line 2 choices from Webex…":saveEnabled
      ?(orgWide?"Save & Sync is enabled for this VisionBank device. Current Webex state is revalidated before any write.":"Pilot Save & Sync is enabled for this device. Current Webex state is revalidated before any write.")
      :reviewEnabled?"Review is enabled, but Save & Sync remains locked until Enterprise Phonism Sync is ready."
      :(state.capabilities?.writes?.pilot===true?"This device is not in the approved write pilot. Browsing remains available.":"Changes remain disabled until device writes are configured."));
  }

  async function openEditor(id){
    if(!state.operatorSession){showOperatorDialog({type:"edit",id});return;}
    const device=state.devices.find(d=>String(d.id)===String(id));if(!device)return;
    state.selected=device;state.preview=null;state.recovery=null;
    const duration=$("deviceLeaseDuration");if(duration)duration.value="60";
    const reason=$("deviceChangeReason");if(reason)reason.value="";
    const details=$("deviceChangePreview");if(details)details.open=false;
    text("deviceEditorTitle",device.displayName||device.model||"Phone");
    text("deviceEditorMeta",[device.model,device.locationName,device.mac].filter(Boolean).join(" · "));
    text("deviceLine1Name",device.line1?.name||device.owner?.name||"Primary line");
    text("deviceLine1Extension",device.line1?.extension||device.owner?.extension||"No extension");
    const wx=registrationValue(device.line1,"webex"),ph=registrationValue(device.line1,"phonism");
    const status=$("deviceLine1Status");
    if(status){status.textContent="Webex "+registrationLabel(wx)+" · Phonism "+registrationLabel(ph);status.className="device-status "+(lineHealthy(device.line1)?"registered":"unknown");}
    renderLeaseExpiryPreview();
    text("deviceLine2PickerValue","Loading Line 2 choices…");
    text("deviceLine2CandidateMeta","Loading eligible users and workspaces across VisionBank Webex…");
    updateEditorActionState(device,{loading:true});
    $("deviceEditor")?.showModal();

    await loadMembers(device);
    if(state.selected!==device)return;
    const select=$("deviceLine2Select");
    if(select)select.value=device.line2?.memberId||device.line2?.id||"";
    renderMemberPickerValue();
    renderCandidate();
    updateEditorActionState(device,{loading:false});
  }

  function renderCandidate(){
    if(state.memberLoadError){text("deviceLine2CandidateMeta","Unable to load available lines: "+state.memberLoadError);return;}
    const m=selectedMember();
    if(m){
      text("deviceLine2CandidateMeta",
        String(m.name||"Member")+" · "+String(m.extension||m.phoneNumber||"No extension")+" · "+
        memberKind(m)+" · "+String(m.locationName||"Location unavailable")+
        (m.currentAssignment?" · current assignment":""));
      return;
    }
    const count=state.memberTotalMatches||state.members.length;
    text("deviceLine2CandidateMeta","None — Line 2 will be unassigned. "+count+" eligible organization-wide line"+(count===1?"":"s")+" available across VisionBank Webex.");
  }

  async function previewChange(){
    if(!state.selected)return;
    const memberId=$("deviceLine2Select")?.value||null;
    const member=memberId?selectedMember():null;
    const memberSearch=member?[member.extension,member.phoneNumber,member.name].find(Boolean)||"":null;
    const button=$("devicePreviewChange");button.disabled=true;
    try{
      const durationMinutes=Number($("deviceLeaseDuration")?.value||60);
      const data=await api("/preview",{method:"POST",body:{
        deviceId:state.selected.id,
        locationId:state.selected.locationId,
        phonismPhoneId:state.selected.phonismPhoneId,
        targetLine2MemberId:memberId,
        targetLine2Search:memberSearch,
        targetLine2LocationId:member?.locationId||null,
        durationMinutes,
        reason:($("deviceChangeReason")?.value||"").trim()
      }});
      state.preview=data.plan||data;
      renderConfirm(state.preview);
      $("deviceConfirm")?.showModal();
    }catch(error){
      text("deviceEditorWarning","Unable to prepare change: "+error.message);
    }finally{
      button.disabled=!(state.capabilities?.writes?.previewReady===true&&state.selected?.writeEligible===true)||Boolean(state.memberLoadError);
    }
  }

  function renderConfirm(plan){
    const host=$("deviceConfirmBody");if(!host)return;
    const before=plan.before?.line2||state.selected?.line2;
    const after=plan.after?.line2;
    host.innerHTML=
      '<div class="device-confirm-row"><span>Operator</span><strong>'+esc(state.operatorSession?.operator?.name||"Unknown")+' · '+esc(state.operatorSession?.operator?.email||"")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Phone</span><strong>'+esc(plan.device?.displayName||state.selected?.displayName||"Phone")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Phone location</span><strong>'+esc(plan.location?.name||state.selected?.locationName||"Location")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Current Line 2</span><strong>'+esc(before?.name||"None")+' '+esc(before?.extension||"")+(before?.locationName?' · '+esc(before.locationName):'')+'</strong></div>'+
      '<div class="device-confirm-row"><span>New Line 2</span><strong>'+esc(after?.name||"None")+' '+esc(after?.extension||"")+'</strong></div>'+
      (after?'<div class="device-confirm-row"><span>Selected line location</span><strong>'+esc(after.locationName||"Location unavailable")+'</strong></div>':"")+
      '<div class="device-confirm-row"><span>Temporary duration</span><strong>'+esc(plan.lease?.durationMinutes?String(plan.lease.durationMinutes)+" minutes":"Temporary")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Auto-revert</span><strong>'+esc(plan.lease?.expiresAt?new Date(plan.lease.expiresAt).toLocaleString():"At lease expiry")+'</strong></div>'+
      '<div class="device-confirm-row"><span>Post-save action</span><strong>'+esc(plan.phonismActionLabel||"Phonism Sync + registration verification")+'</strong></div>'+
      (($("deviceChangeReason")?.value||"").trim()?'<div class="device-confirm-row"><span>Reason</span><strong>'+esc(($("deviceChangeReason")?.value||"").trim())+'</strong></div>':"")+
      '<p class="device-helper">'+esc(plan.summary||"The backend will revalidate current state before any write.")+'</p>';
    $("deviceApplyChange").disabled=plan.executable!==true;
    if(plan.executable!==true)host.insertAdjacentHTML("beforeend",'<p class="device-warning">Review is complete, but Save & Sync is locked until the Enterprise Phonism Sync owner is resolved.</p>');
  }

  function storePostSaveContext(result){
    const context={
      leaseId:result?.leaseId||"",
      locationId:state.selected?.locationId||"",
      phonismPhoneId:state.selected?.phonismPhoneId||"",
      deviceName:state.selected?.displayName||"",
      search:$("deviceSearch")?.value||state.selected?.displayName||"",
      savedAt:new Date().toISOString()
    };
    state.postSave=context;
    try{sessionStorage.setItem(POST_SAVE_KEY,JSON.stringify(context));}catch{}
    return context;
  }

  function clearPostSaveContext(){
    state.postSave=null;
    try{sessionStorage.removeItem(POST_SAVE_KEY);}catch{}
  }

  async function applyChange(){
    if(!state.preview)return;
    const btn=$("deviceApplyChange");btn.disabled=true;btn.textContent="Saving & Syncing…";
    const host=$("deviceConfirmBody");
    host?.querySelector(".device-apply-error")?.remove();
    try{
      const result=await api("/apply",{method:"POST",body:{mutationId:state.preview.mutationId}});
      storePostSaveContext(result);
      $("deviceConfirm")?.close();$("deviceEditor")?.close();
      text("deviceInventoryStatus",result.message||"Save & Sync accepted. Refreshing the page to show the new temporary line…");
      window.location.reload();
      return;
    }catch(error){
      const message=friendlyDeviceError(error);
      if((error.code||error.message)==="target-appearance-limit"){
        const targetId=state.preview?.after?.line2?.id||"";
        const select=$("deviceLine2Select");
        const option=select?[...select.options].find(o=>String(o.value)===String(targetId)):null;
        if(option){option.disabled=true;if(!option.textContent.includes("appearance limit"))option.textContent+=" — unavailable (appearance limit reached)";}
        if(select)select.value="";
        state.preview=null;
        $("deviceConfirm")?.close();
        text("deviceEditorWarning",message);
        renderMemberPickerValue();
        renderMemberSearchResults();
        renderCandidate();
      }else{
        if(host)host.insertAdjacentHTML("beforeend",'<p class="device-warning device-apply-error">'+esc(message)+'</p>');
      }
    }finally{
      btn.textContent="Save & Sync";
      btn.disabled=state.preview?.executable!==true;
    }
  }

  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  async function finishVerifiedLease(last,message){
    text("deviceInventoryStatus",message);
    $("deviceRecovery")?.close();state.recovery=null;
    if(state.postSave?.locationId&&state.postSave?.phonismPhoneId){
      await refreshDeviceDetail(state.postSave.locationId,state.postSave.phonismPhoneId).catch(()=>null);
    }else{
      await loadInventory(true);
    }
    clearPostSaveContext();
    return last;
  }

  async function pollLeaseVerification(leaseId,{attempts=6,delayMs=5000}={}){
    let last=null;
    for(let i=0;i<attempts;i++){
      try{
        last=await api("/lease-status?leaseId="+encodeURIComponent(leaseId));
        state.recovery={leaseId,rebootAvailable:last.rebootAvailable===true};
        if(last.state==="applied"){
          return await finishVerifiedLease(last,"Save & Sync completed. Webex and Phonism are confirmed after the automatic reboot. Temporary lease expires "+new Date(last.expiresAt).toLocaleString()+".");
        }
        if(last.state==="applied-unverified"){
          return await finishVerifiedLease(last,"Save & Sync completed and the automatic reboot was queued. Webex and Phonism contain the temporary line, but Phonism does not provide registration telemetry for this handset. Temporary lease expires "+new Date(last.expiresAt).toLocaleString()+".");
        }
        if(last.state==="reboot-failed"){
          text("deviceRecoveryReason","The line change and Phonism Sync completed, but the automatic reboot could not be queued. Use Reboot & Reverify.");
          $("deviceRecovery")?.showModal();
          return last;
        }
        if(last.state==="registration-failed"){
          text("deviceRecoveryReason","The temporary line is present but registration is explicitly failing after reboot. Use Reboot & Reverify.");
          $("deviceRecovery")?.showModal();
          return last;
        }
      }catch(error){
        text("deviceInventoryStatus","Verification check delayed: "+error.message);
      }
      if(i<attempts-1)await wait(delayMs);
    }
    text("deviceRecoveryReason","The temporary line has not fully converged after the automatic reboot. Use Reboot & Reverify if the handset still needs attention.");
    const reboot=$("deviceReboot");if(reboot)reboot.disabled=!state.recovery?.rebootAvailable;
    $("deviceRecovery")?.showModal();
    if(state.postSave?.locationId&&state.postSave?.phonismPhoneId){
      await refreshDeviceDetail(state.postSave.locationId,state.postSave.phonismPhoneId).catch(()=>null);
    }
    return last;
  }

  async function rebootRecovery(){
    if(!state.recovery?.leaseId)return;
    const leaseId=state.recovery.leaseId;
    const btn=$("deviceReboot");if(btn){btn.disabled=true;btn.textContent="Rebooting…";}
    try{
      const result=await api("/reboot",{method:"POST",body:{leaseId}});
      text("deviceRecoveryReason",result.message||"Reboot queued. Waiting for the phone to reconnect and rechecking Line 2.");
      await wait(8000);
      await pollLeaseVerification(leaseId,{attempts:6,delayMs:5000});
    }catch(error){
      text("deviceRecoveryReason","Reboot recovery was not completed: "+friendlyDeviceError(error));
    }finally{
      if(btn){btn.textContent="Reboot & Reverify";btn.disabled=false;}
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
        '<td><strong>'+esc(r.operatorName||"Unknown")+'</strong><small>'+esc(r.operatorEmail||"")+'</small>'+
          (r.operatorVerified===true?'<span class="device-audit-identity verified">Email verified</span>':
            r.verificationMethod==="disabled"?'<span class="device-audit-identity disabled">Verification off</span>':'')+'</td>'+
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
    $("deviceLocationFilter")?.addEventListener("change",()=>void loadInventory(false));
    $("deviceClearFilters")?.addEventListener("click",()=>{
      $("deviceSearch").value="";$("deviceOwnerFilter").value="";$("deviceWebexRegistrationFilter").value="";$("devicePhonismRegistrationFilter").value="";applyFilters();
    });
    $("deviceRefresh")?.addEventListener("click",async()=>{
      const button=$("deviceRefresh");if(button){button.disabled=true;button.textContent="Refreshing…";}
      try{await Promise.allSettled([loadIdentityPolicy(),loadCapabilities(),loadLocations(),loadInventory(true)]);}
      finally{if(button){button.disabled=false;button.textContent="Refresh";}}
    });
    $("deviceOperatorButton")?.addEventListener("click",()=>showOperatorDialog(null));
    $("deviceSignOutButton")?.addEventListener("click",()=>void signOutOperator());
    $("deviceOperatorForm")?.addEventListener("submit",event=>void submitOperator(event));
    $("deviceOperatorClose")?.addEventListener("click",()=>{state.pendingOperatorAction=null;resetVerificationStep();$("deviceOperatorDialog")?.close();});
    $("deviceOperatorCancel")?.addEventListener("click",()=>{state.pendingOperatorAction=null;resetVerificationStep();$("deviceOperatorDialog")?.close();});
    $("deviceVerificationResend")?.addEventListener("click",()=>void resendVerificationCode());
    $("deviceAdminButton")?.addEventListener("click",()=>void openAdminSettings());
    $("deviceAdminClose")?.addEventListener("click",()=>$("deviceAdminDialog")?.close());
    $("deviceVerificationToggle")?.addEventListener("change",()=>void updateVerificationSetting());
    $("deviceDefaultVerificationSave")?.addEventListener("click",()=>void updateDefaultVerificationHours());
    $("deviceDurationSaveButton")?.addEventListener("click",()=>void setUserDuration());
    $("deviceDurationEmailInput")?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();void setUserDuration();}});
    $("deviceDurationHoursInput")?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();void setUserDuration();}});
    $("deviceAdminAddButton")?.addEventListener("click",()=>void addAdmin());
    $("deviceAdminEmailInput")?.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();void addAdmin();}});
    $("deviceHistoryRefresh")?.addEventListener("click",()=>void loadHistory());
    $("deviceLine2PickerButton")?.addEventListener("click",()=>{
      const panel=$("deviceLine2PickerPanel");
      if(panel?.hidden===false)closeMemberPicker();else openMemberPicker();
    });
    $("deviceLine2Search")?.addEventListener("input",scheduleMemberSearch);
    $("deviceLine2Search")?.addEventListener("keydown",event=>{
      if(event.key==="Escape"){event.preventDefault();closeMemberPicker();$("deviceLine2PickerButton")?.focus();return;}
      if(event.key==="ArrowDown"){
        const first=[...document.querySelectorAll("#deviceLine2Results [data-member-choice]")].find(btn=>!btn.disabled);
        if(first){event.preventDefault();first.focus();}
      }
    });
    $("deviceLeaseDuration")?.addEventListener("change",renderLeaseExpiryPreview);
    $("deviceEditor")?.addEventListener("close",()=>{closeMemberPicker();state.memberSearchController?.abort();state.memberDetailController?.abort();});
    $("devicePreviewChange")?.addEventListener("click",()=>void previewChange());
    $("deviceApplyChange")?.addEventListener("click",()=>void applyChange());
    $("deviceConfirmClose")?.addEventListener("click",()=>$("deviceConfirm")?.close());
    $("deviceConfirmCancel")?.addEventListener("click",()=>$("deviceConfirm")?.close());
    $("deviceRecoveryClose")?.addEventListener("click",()=>$("deviceRecovery")?.close());
    $("deviceRecoveryCancel")?.addEventListener("click",()=>$("deviceRecovery")?.close());
    $("deviceReboot")?.addEventListener("click",()=>void rebootRecovery());
    window.addEventListener("storage",event=>{if(event.key==="vb_session")void loadIdentityPolicy();});
  }

  async function resumePostSave(){
    let saved=null;
    try{saved=JSON.parse(sessionStorage.getItem(POST_SAVE_KEY)||"null");}catch{}
    if(!saved?.leaseId)return;
    const savedAt=Date.parse(saved.savedAt||"");
    if(Number.isFinite(savedAt)&&Date.now()-savedAt>24*60*60*1000){clearPostSaveContext();return;}
    state.postSave=saved;
    if(saved.search&&$("deviceSearch"))$("deviceSearch").value=saved.search;
    if(saved.locationId&&saved.phonismPhoneId){
      await refreshDeviceDetail(saved.locationId,saved.phonismPhoneId).catch(()=>null);
    }
    text("deviceInventoryStatus","Change saved. Showing the refreshed device state while Webex and Phonism verification continues…");
    await pollLeaseVerification(saved.leaseId);
  }

  async function init(){
    bind();
    renderOperator();
    if(!await securityCheck())return;
    hydrateReadCache();
    await loadIdentityPolicy();
    await Promise.allSettled([
      restoreOperatorSession(),
      loadCapabilities(),
      loadLocations(),
      loadInventory(false)
    ]);
    await resumePostSave();
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else void init();
})();
