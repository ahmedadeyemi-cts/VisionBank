const OWNER_TYPES=new Set(["PEOPLE","PLACE"]);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export class DeviceManagementError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}

export function normalizeMac(value){
  const raw=String(value||"").replace(/[^0-9a-f]/gi,"").toUpperCase();
  if(raw.length!==12)throw new DeviceManagementError("invalid-mac");
  return raw.match(/.{2}/g).join(":");
}

export function normalizeOwnerType(value){
  let type=String(value||"").trim().toUpperCase();
  if(type==="WORKSPACE")type="PLACE";
  if(!OWNER_TYPES.has(type))throw new DeviceManagementError("unsupported-owner-type");
  return type;
}

export function normalizeRegistration(value){
  const status=String(value||"unknown").trim().toLowerCase();
  if(["registered","online","active"].includes(status))return "registered";
  if(["unregistered","offline","failed","inactive"].includes(status))return "unregistered";
  if(["pending","registering","provisioning"].includes(status))return "pending";
  return "unknown";
}

export function assertDevice(device){
  if(!device||typeof device!=="object")throw new DeviceManagementError("device-required");
  if(!device.id)throw new DeviceManagementError("device-id-required");
  if(!device.locationId)throw new DeviceManagementError("device-location-required");
  if(device.mac)normalizeMac(device.mac);
  return device;
}

export function assertAssignableMember(member,device){
  assertDevice(device);
  if(member===null)return null;
  if(!member||typeof member!=="object"||!member.id)throw new DeviceManagementError("member-required");
  normalizeOwnerType(member.type);
  if(!member.locationId)throw new DeviceManagementError("member-location-required");
  if(String(member.locationId)!==String(device.locationId))throw new DeviceManagementError("cross-location-assignment-denied",409);
  if(!String(member.extension||member.phoneNumber||"").trim())throw new DeviceManagementError("member-number-required");
  return member;
}

export function validateApplyRequest(value){
  if(!value||!UUID.test(String(value.mutationId||"")))throw new DeviceManagementError("invalid-mutation-id");
  if(!Number.isSafeInteger(value.expectedVersion)||value.expectedVersion<0)throw new DeviceManagementError("invalid-expected-version");
  if(Object.keys(value).some(k=>!["mutationId","expectedVersion"].includes(k)))throw new DeviceManagementError("unknown-apply-field");
  return {mutationId:value.mutationId,expectedVersion:value.expectedVersion};
}

export function validatePostSaveAction(action){
  if(!action||typeof action!=="object")throw new DeviceManagementError("phonism-action-not-verified",409);
  const id=String(action.id||"").trim().toLowerCase();
  if(!id||action.verifiedNonDestructive!==true)throw new DeviceManagementError("phonism-action-not-verified",409);
  if(["factory-reset","factory_reset","reset-config","reset_configuration"].includes(id))throw new DeviceManagementError("destructive-phonism-action-denied",409);
  return {id,label:String(action.label||id).slice(0,120),verifiedNonDestructive:true};
}

export function registrationConvergence({webex,phonism}={}){
  const webexStatus=normalizeRegistration(webex),phonismStatus=normalizeRegistration(phonism);
  let state="pending-verification";
  if(webexStatus==="registered"&&phonismStatus==="registered")state="completed";
  else if(webexStatus==="unregistered"||phonismStatus==="unregistered")state="mismatch";
  else if(webexStatus==="unknown"&&phonismStatus==="unknown")state="unknown";
  return {webexStatus,phonismStatus,state,healthy:state==="completed"};
}

export function validateFactoryResetRecovery(value){
  if(!value||typeof value!=="object")throw new DeviceManagementError("recovery-request-required");
  if(!UUID.test(String(value.recoveryId||"")))throw new DeviceManagementError("invalid-recovery-id");
  if(!Number.isSafeInteger(value.expectedVersion)||value.expectedVersion<0)throw new DeviceManagementError("invalid-expected-version");
  if(value.syncAttempted!==true)throw new DeviceManagementError("sync-required-before-factory-reset",409);
  if(!["mismatch","unknown"].includes(String(value.verificationState||"")))throw new DeviceManagementError("factory-reset-not-eligible",409);
  if(value.endpointVerified!==true)throw new DeviceManagementError("factory-reset-endpoint-not-verified",409);
  if(value.explicitConfirmation!==true)throw new DeviceManagementError("factory-reset-confirmation-required",409);
  return {recoveryId:value.recoveryId,expectedVersion:value.expectedVersion};
}

export function buildChangePlan({device,targetMember,currentLine2=null,version=0,mutationId,capabilities={},postSaveAction=null}){
  assertDevice(device);
  const member=assertAssignableMember(targetMember,device);
  if(!UUID.test(String(mutationId||"")))throw new DeviceManagementError("invalid-mutation-id");
  if(!Number.isSafeInteger(version)||version<0)throw new DeviceManagementError("invalid-device-version");
  let action=null;
  try{action=validatePostSaveAction(postSaveAction);}catch(error){if(error.code!=="phonism-action-not-verified")throw error;}
  const writeReady=capabilities.webexWrite===true&&capabilities.phonismWrite===true&&Boolean(action);
  return {
    mutationId,expectedVersion:version,executable:writeReady,
    device:{id:device.id,displayName:device.displayName||device.model||"Phone",locationId:device.locationId,mac:device.mac||null},
    location:{id:device.locationId,name:device.locationName||"Location"},
    before:{line2:currentLine2},
    after:{line2:member?{memberId:member.id,name:member.name||member.displayName||"Member",extension:member.extension||member.phoneNumber,type:normalizeOwnerType(member.type)}:null},
    phonismActionLabel:action?.label||"Phonism Sync + registration verification",
    summary:writeReady?"Current state will be revalidated, Webex will be saved, Phonism Sync will be forced, and both registration states will be re-read.":"Preview only: Webex write and Phonism Sync are not fully validated."
  };
}
