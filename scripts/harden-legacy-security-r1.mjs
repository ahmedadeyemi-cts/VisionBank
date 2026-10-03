import fs from 'node:fs';

const input=process.argv[2];
const output=process.argv[3];
if(!input||!output)throw new Error('usage: node scripts/harden-legacy-security-r1.mjs <input> <output>');
let s=fs.readFileSync(input,'utf8');

function replaceOnce(oldText,newText,label){
  const count=s.split(oldText).length-1;
  if(count!==1)throw new Error(label+' expected exactly one anchor, found '+count);
  s=s.replace(oldText,newText);
}

function replaceBetween(start,end,replacement,label){
  const a=s.indexOf(start);
  if(a<0)throw new Error(label+' start anchor missing');
  const b=s.indexOf(end,a);
  if(b<0)throw new Error(label+' end anchor missing');
  s=s.slice(0,a)+replacement+'\n'+s.slice(b);
}

function replaceWithin(start,end,oldText,newText,label){
  const a=s.indexOf(start);
  if(a<0)throw new Error(label+' start anchor missing');
  const b=s.indexOf(end,a);
  if(b<0)throw new Error(label+' end anchor missing');
  const segment=s.slice(a,b);
  const count=segment.split(oldText).length-1;
  if(count!==1)throw new Error(label+' expected exactly one inner anchor, found '+count);
  s=s.slice(0,a)+segment.replace(oldText,newText)+s.slice(b);
}

replaceOnce(
  '  const path = url.pathname;\n',
  '  const path = url.pathname;\n\n  const legacyPolicy = legacySecurityRoutePolicy(path, method);\n  if (legacyPolicy) {\n    const authorization = await authorizeLegacySecurityRequest(request, env, legacyPolicy);\n    if (!authorization.ok) return json({ error: authorization.error }, cors, authorization.status);\n  }\n  if (legacyNetworkOnlyRoute(path, method)) {\n    const access = await checkAccess(request, env);\n    if (!access.allowed) return json({ error: "access-denied" }, cors, 403);\n  }\n',
  'route-security-gate'
);

replaceOnce(
  '      if (path === "/api/login" && method === "POST") {\n        return handleLogin(request, env, cors);\n      }',
  '      if (path === "/api/login" && method === "POST") {\n        return handleLogin(request, env, cors);\n      }\n\n      if (path === "/api/logout" && method === "POST") {\n        const auth = String(request.headers.get("Authorization") || "");\n        if (auth.toLowerCase().startsWith("bearer ")) {\n          const sessionId = auth.slice(7).trim();\n          if (sessionId) await env.SESSIONS.delete(sessionId);\n        }\n        return json({ success: true }, cors);\n      }',
  'security-logout-route'
);
const securityHelpers=String.raw`
const LEGACY_SECURITY_ROLES = new Set(["superadmin","admin","analyst","auditor","view"]);
const PRIVATE_PORTAL_EMAIL_SHA256 = "b8d80694889fa73ef35efc6d63ffcd481fc769f4a97fc33e25f2cbbe15ce8ae9";
const PASSWORD_SCHEME = "pbkdf2-sha256-v1";
const PASSWORD_ITERATIONS = 210000;
const LOGIN_RATE_PREFIX = "security-login-rate:";
const MFA_SETUP_PREFIX = "security-mfa-setup:";
const MFA_PENDING_PREFIX = "pending:";
const MFA_SETUP_TTL_SECONDS = 10 * 60;

function legacySecurityRoutePolicy(path, method) {
  if (path === "/api/users/list" && method === "GET") return { roles: ["superadmin"] };
  if (["/api/users/save","/api/users/delete","/api/users/reset-mfa"].includes(path) && method === "POST") return { roles: ["superadmin"] };
  if (["/api/get-hours","/api/get-ip-rules"].includes(path) && method === "GET") return { roles: [...LEGACY_SECURITY_ROLES] };
  if (["/api/set-hours","/api/set-ip-rules"].includes(path) && method === "POST") return { roles: ["superadmin","admin","analyst"] };
  if (path === "/api/logs" && method === "GET") return { roles: ["superadmin","admin","auditor"] };
  if (path === "/api/validate-ip" && method === "POST") return { roles: ["superadmin","admin","analyst","auditor"] };
  return null;
}

function legacyNetworkOnlyRoute(path, method) {
  const key=method+" "+path;
  return new Set([
    "GET /api/fax/schedule/get","POST /api/fax/schedule/save","POST /api/fax/schedule/delete",
    "GET /api/voicemails/schedule/get","POST /api/voicemails/schedule/save","POST /api/voicemails/schedule/delete",
    "GET /api/agents/settings/get","POST /api/agents/settings/save",
    "GET /api/agents/logout/settings","POST /api/agents/logout/settings/save",
    "POST /api/directory/save"
  ]).has(key);
}

async function authorizeLegacySecurityRequest(request, env, policy) {
  const access = await checkAccess(request, env);
  if (!access.allowed) return { ok:false, status:403, error:"access-denied" };
  const session = await getVisionBankSessionFromRequest(request, env);
  if (!session) return { ok:false, status:401, error:"session-required" };
  const role = String(session.role || "").toLowerCase();
  if (!policy.roles.includes(role)) return { ok:false, status:403, error:"role-denied" };
  return { ok:true, session, access };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function constantTimeStringEqual(a,b) {
  const aa=String(a||""), bb=String(b||"");
  let diff=aa.length ^ bb.length;
  const max=Math.max(aa.length,bb.length);
  for(let i=0;i<max;i++) diff |= (aa.charCodeAt(i%Math.max(aa.length,1))||0) ^ (bb.charCodeAt(i%Math.max(bb.length,1))||0);
  return diff===0;
}

async function portalSha256Hex(value) {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

async function isApprovedPortalEmail(value) {
  const mail=String(value||"").trim().toLowerCase();
  const domain=mail.split("@")[1]||"";
  if(domain==="visionbank.com"||domain==="ussignal.com") return true;
  return (await portalSha256Hex(mail))===PRIVATE_PORTAL_EMAIL_SHA256;
}

function isApprovedReportRecipient(value) {
  const mail=String(value||"").trim().toLowerCase();
  const domain=mail.split("@")[1]||"";
  return domain==="visionbank.com"||domain==="ussignal.com";
}

async function makePasswordRecord(password) {
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(password)),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:PASSWORD_ITERATIONS},key,256);
  return {
    passwordScheme:PASSWORD_SCHEME,
    passwordHash:bytesToBase64(new Uint8Array(bits)),
    passwordSalt:bytesToBase64(salt),
    passwordIterations:PASSWORD_ITERATIONS
  };
}

async function verifyStoredPassword(user,password) {
  if(user?.passwordScheme===PASSWORD_SCHEME&&user?.passwordHash&&user?.passwordSalt){
    const salt=base64ToBytes(user.passwordSalt);
    const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(password)),"PBKDF2",false,["deriveBits"]);
    const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:Number(user.passwordIterations)||PASSWORD_ITERATIONS},key,256);
    return {ok:constantTimeStringEqual(bytesToBase64(new Uint8Array(bits)),user.passwordHash),legacy:false};
  }
  return {ok:typeof user?.password==="string"&&constantTimeStringEqual(user.password,password),legacy:true};
}

async function migrateLegacyPassword(env,user,password) {
  const record=await makePasswordRecord(password);
  const next={...user,...record,passwordMigratedAt:new Date().toISOString()};
  delete next.password;
  await saveUser(env,next);
  return next;
}

function safeUserForClient(user) {
  return {
    username:user?.username||"",
    email:user?.email||"",
    role:user?.role||"view",
    mfaEnabled:user?.mfaEnabled===true,
    passwordHashed:user?.passwordScheme===PASSWORD_SCHEME
  };
}

function actorIpForSecurity(request) {
  return String(request.headers.get("CF-Connecting-IPv6")||request.headers.get("CF-Connecting-IP")||"unknown").slice(0,64);
}

async function loginRateKey(username,ip) {
  return LOGIN_RATE_PREFIX + await portalSha256Hex(String(username||"").toLowerCase()+"|"+String(ip||""));
}

async function readLoginRate(env,username,ip) {
  const key=await loginRateKey(username,ip);
  let value=null;
  try{const raw=await env.SESSIONS.get(key);value=raw?JSON.parse(raw):null;}catch{}
  return {key,value:value||{windowStart:Date.now(),failures:0,blockedUntil:0}};
}

async function assertLoginRateAllowed(env,username,ip) {
  const {value}=await readLoginRate(env,username,ip);
  if(Number(value.blockedUntil||0)>Date.now()) {
    const error=new Error("Too many failed login attempts. Try again later.");
    error.status=429;throw error;
  }
}

async function recordLoginFailure(env,username,ip) {
  const now=Date.now(),windowMs=15*60*1000;
  const {key,value}=await readLoginRate(env,username,ip);
  const next=(!value.windowStart||now-Number(value.windowStart)>=windowMs)
    ?{windowStart:now,failures:1,blockedUntil:0}
    :{...value,failures:Number(value.failures||0)+1};
  if(next.failures>=10)next.blockedUntil=now+windowMs;
  await env.SESSIONS.put(key,JSON.stringify(next),{expirationTtl:30*60});
}

async function clearLoginRate(env,username,ip) {
  const key=await loginRateKey(username,ip);
  await env.SESSIONS.delete(key);
}

async function issueMfaSetupTicket(env,request,username) {
  const token=crypto.randomUUID(),now=Date.now();
  const value={username:String(username||"").toLowerCase(),ip:actorIpForSecurity(request),expires:now+MFA_SETUP_TTL_SECONDS*1000};
  await env.SESSIONS.put(MFA_SETUP_PREFIX+token,JSON.stringify(value),{expirationTtl:MFA_SETUP_TTL_SECONDS});
  return token;
}

async function requireMfaSetupTicket(env,request,username,token) {
  const id=String(token||"");
  if(!/^[0-9a-f-]{36}$/i.test(id))return null;
  const raw=await env.SESSIONS.get(MFA_SETUP_PREFIX+id);
  if(!raw)return null;
  let value;try{value=JSON.parse(raw);}catch{return null;}
  if(value.username!==String(username||"").toLowerCase()||Number(value.expires||0)<=Date.now())return null;
  if(value.ip&&value.ip!=="unknown"&&value.ip!==actorIpForSecurity(request))return null;
  return {id,...value};
}
`;
replaceOnce(
  'async function getVisionBankSessionFromRequest(request, env) {',
  securityHelpers+'\nasync function getVisionBankSessionFromRequest(request, env) {',
  'security-helper-injection'
);

replaceOnce(
  '  const ipOk = rules.length === 0 || isIpAllowedWithCidrs(ip, rules);',
  '  const ipOk = rules.length > 0 && isIpAllowedWithCidrs(ip, rules);',
  'fail-closed-ip-allowlist'
);
const hardenedLogin=String.raw`
async function handleLogin(request, env, cors) {
  const access=await checkAccess(request,env);
  if(!access.allowed)return json({error:"access-denied"},cors,403);

  const body=await request.json();
  const username=normalizeUsername(body.username);
  const password=String(body.password||"");
  const totp=String(body.totp||"");
  const ip=actorIpForSecurity(request);

  try{await assertLoginRateAllowed(env,username,ip);}
  catch(error){return json({error:error.message},cors,error.status||429);}

  let user=await getUser(env,username);
  if(!user||!(await isApprovedPortalEmail(user.email))){
    await recordLoginFailure(env,username,ip);
    return json({error:"Invalid username or password"},cors,401);
  }

  const passwordResult=await verifyStoredPassword(user,password);
  if(!passwordResult.ok){
    await recordLoginFailure(env,username,ip);
    return json({error:"Invalid username or password"},cors,401);
  }

  if(passwordResult.legacy)user=await migrateLegacyPassword(env,user,password);

  const secret=await env.MFA.get(username);
  if(user.mfaEnabled){
    if(!secret){
      const setupToken=await issueMfaSetupTicket(env,request,username);
      return json({requireMfaSetup:true,setupToken},cors);
    }
    if(!totp)return json({requireTotp:true},cors);
    const ok=await verifyTotp(secret,totp);
    if(!ok){
      await recordLoginFailure(env,username,ip);
      return json({error:"Invalid MFA code"},cors,401);
    }
  }

  await clearLoginRate(env,username,ip);
  const session=await createSession(env,username,user.role);
  if(user.email){
    const actor=getActorContext(request);
    await sendEmail(env,{
      to:user.email,
      subject:"VisionBank Login Alert",
      text:"A login to your VisionBank account was detected.\n\nUsername: "+username+"\nRole: "+user.role+"\nIP Address: "+actor.ip+"\nLocation: "+actor.city+", "+actor.country+"\nBrowser: "+actor.browser+"\n\nIf this was not you, contact IT immediately.",
      html:renderVisionBankEmail("Login Detected","A login to your VisionBank account was detected for <strong>"+username+"</strong>.","IP Address: "+actor.ip+"<br>Location: "+actor.city+", "+actor.region+" ("+actor.regionCode+"), "+actor.country+"<br>Timezone: "+actor.timezone+"<br>Browser: "+actor.browser+"<br>Cloudflare Ray ID: "+actor.rayId)
    });
  }
  return json({success:true,session,user:{username,role:user.role,mfaEnabled:user.mfaEnabled}},cors);
}
`;

replaceBetween(
  'async function handleLogin(request, env, cors) {',
  '/*******************************************************************************************\n * MFA SETUP',
  hardenedLogin,
  'harden-login'
);
const hardenedMfaSetup=String.raw`
async function handleMfaSetup(request, env, cors) {
  const access=await checkAccess(request,env);
  if(!access.allowed)return json({error:"access-denied"},cors,403);

  const body=await request.json();
  const username=normalizeUsername(body.username);
  const ticket=await requireMfaSetupTicket(env,request,username,body.setupToken);
  if(!ticket)return json({error:"mfa-setup-ticket-required"},cors,403);

  const user=await getUser(env,username);
  if(!user||!(await isApprovedPortalEmail(user.email)))return json({error:"User not found"},cors,404);
  if(await env.MFA.get(username))return json({error:"MFA is already configured"},cors,409);

  const secret=generateSecret();
  await env.MFA.put(MFA_PENDING_PREFIX+username+":"+ticket.id,secret,{expirationTtl:MFA_SETUP_TTL_SECONDS});

  if(user.email){
    const actor=getActorContext(request);
    await sendEmail(env,{
      to:user.email,
      subject:"MFA Enrollment Started",
      text:"MFA enrollment has started on your VisionBank account.\n\nIP Address: "+actor.ip+"\nLocation: "+actor.city+", "+actor.country+"\nBrowser: "+actor.browser,
      html:renderVisionBankEmail("MFA Enrollment Started","MFA enrollment has started on your VisionBank account.","IP Address: "+actor.ip+"<br>Location: "+actor.city+", "+actor.region+", "+actor.country+"<br>Browser: "+actor.browser)
    });
  }

  const uri="otpauth://totp/VisionBank:"+encodeURIComponent(username)+"?secret="+secret+"&issuer=VisionBank";
  const qr="https://api.qrserver.com/v1/create-qr-code/?data="+encodeURIComponent(uri)+"&size=200x200";
  return json({qr,secret,setupToken:ticket.id},cors);
}
`;

replaceBetween(
  'async function handleMfaSetup(request, env, cors) {',
  '/*******************************************************************************************\n * MFA CONFIRM',
  hardenedMfaSetup,
  'harden-mfa-setup'
);
const hardenedMfaConfirm=String.raw`
async function handleMfaConfirm(request, env, cors) {
  const access=await checkAccess(request,env);
  if(!access.allowed)return json({error:"access-denied"},cors,403);

  const body=await request.json();
  const username=normalizeUsername(body.username);
  const ticket=await requireMfaSetupTicket(env,request,username,body.setupToken);
  if(!ticket)return json({error:"mfa-setup-ticket-required"},cors,403);

  const pendingKey=MFA_PENDING_PREFIX+username+":"+ticket.id;
  const secret=await env.MFA.get(pendingKey);
  if(!secret)return json({error:"MFA setup expired"},cors,410);

  const ok=await verifyTotp(secret,String(body.code||""));
  if(!ok)return json({error:"Invalid MFA code"},cors,401);

  await env.MFA.put(username,secret);
  await env.MFA.delete(pendingKey);
  await env.SESSIONS.delete(MFA_SETUP_PREFIX+ticket.id);

  const user=await getUser(env,username);
  if(user?.email){
    const actor=getActorContext(request);
    await sendEmail(env,{
      to:user.email,
      subject:"Multi-Factor Authentication Activated",
      text:"Multi-factor authentication has been activated on your VisionBank account.\n\nIP Address: "+actor.ip+"\nLocation: "+actor.city+", "+actor.country+"\nBrowser: "+actor.browser,
      html:renderVisionBankEmail("MFA Activated","Multi-factor authentication has been activated on your account.","IP Address: "+actor.ip+"<br>Location: "+actor.city+", "+actor.region+", "+actor.country+"<br>Browser: "+actor.browser)
    });
  }
  return json({success:true},cors);
}
`;

replaceBetween(
  'async function handleMfaConfirm(request, env, cors) {',
  '/*******************************************************************************************\n * USER MANAGEMENT',
  hardenedMfaConfirm,
  'harden-mfa-confirm'
);
const hardenedUserSave=String.raw`
async function handleUserSave(request, env, cors) {
  const body=await request.json();
  const actor=getActorContext(request);
  const username=normalizeUsername(body.username);
  const password=String(body.password||"");
  const role=String(body.role||"view").toLowerCase();
  const mfaEnabled=body.mfaEnabled===true;
  const existingUser=await getUser(env,username);
  const finalEmail=String(body.email||existingUser?.email||"").trim().toLowerCase();

  if(!username)return json({error:"Username required"},cors,400);
  if(!existingUser&&!password)return json({error:"Password required for new users"},cors,400);
  if(!["superadmin","admin","analyst","auditor","view"].includes(role))return json({error:"Invalid role"},cors,400);
  if(!finalEmail||!(await isApprovedPortalEmail(finalEmail)))return json({error:"Email is not authorized for this portal"},cors,403);

  const changes=[];
  if(existingUser){
    if(password)changes.push("Password");
    if(finalEmail!==String(existingUser.email||"").toLowerCase())changes.push("Email address");
    if(String(existingUser.role||"view").toLowerCase()!==role)changes.push("Role");
    if(Boolean(existingUser.mfaEnabled)!==mfaEnabled)changes.push("MFA setting");
  }

  const next={...(existingUser||{}),username,role,mfaEnabled,email:finalEmail};
  if(password){
    Object.assign(next,await makePasswordRecord(password),{passwordChangedAt:new Date().toISOString()});
    delete next.password;
  }
  await saveUser(env,next);

  if(existingUser&&changes.length){
    await sendEmail(env,{
      to:finalEmail,
      subject:"Your VisionBank Account Was Updated",
      text:"Changes were made to your VisionBank Security account.\n\nUsername: "+username+"\nUpdated items:\n- "+changes.join("\n- ")+"\n\nIP Address: "+actor.ip+"\nLocation: "+actor.city+", "+actor.country+"\nBrowser: "+actor.browser+"\n\nIf you did not authorize these changes, contact IT security immediately.",
      html:renderVisionBankEmail("Account Update Detected","Changes were made to your VisionBank account for <strong>"+username+"</strong>.","Updated items:<br>- "+changes.join("<br>- ")+"<br><br>IP Address: "+actor.ip+"<br>Location: "+actor.city+", "+actor.region+", "+actor.country+"<br>Browser: "+actor.browser)
    });
    await queueSuperadminEvent(env,{action:"USER_UPDATED",severity:calculateSeverity(changes),target:username,changes,actor});
  }

  if(!existingUser){
    await sendEmail(env,{
      to:finalEmail,
      subject:"Your VisionBank Access Has Been Created",
      text:"Your VisionBank Security Console account has been created.\n\nUsername: "+username+"\nRole: "+role+"\n\nIf you did not expect this access, contact IT immediately.",
      html:renderVisionBankEmail("Account Created","Your VisionBank Security Console account has been successfully created.","Username: "+username+"<br>Role: "+role)
    });
  }

  return json({success:true,user:safeUserForClient(next)},cors);
}
`;

replaceBetween(
  'async function handleUserSave(request, env, cors) {',
  'async function handleUserDelete(request, env, cors) {',
  hardenedUserSave,
  'harden-user-save'
);
replaceOnce(
  'async function handleUserList(env, cors) {\n  const users = await loadAllUsers(env);\n  return json({ users }, cors);\n}',
  'async function handleUserList(env, cors) {\n  const users = (await loadAllUsers(env)).map(safeUserForClient);\n  return json({ users }, cors);\n}',
  'sanitize-user-list'
);

replaceOnce(
  '  console.log("ALIANZA AUTH STATUS:", res.status);\n  console.log("ALIANZA AUTH RESPONSE:", text);',
  '  console.log("ALIANZA AUTH STATUS:", res.status);',
  'remove-alianza-auth-response-log'
);
replaceOnce(
  '    throw new Error(`Alianza auth returned non-JSON: ${text}`);',
  '    throw new Error("Alianza auth returned an invalid response.");',
  'sanitize-alianza-invalid-json-error'
);
replaceOnce(
  '    throw new Error(`Alianza auth failed: ${res.status} ${text}`);',
  '    throw new Error("Alianza auth failed with HTTP "+res.status);',
  'sanitize-alianza-auth-error'
);
replaceOnce(
  '  console.log("BREVO EMAIL RESPONSE:", responseText);',
  '  console.log("BREVO EMAIL RESPONSE RECEIVED:", Boolean(responseText));',
  'sanitize-brevo-log'
);

replaceOnce(
  '      console.log("ALIANZA CDR SAMPLE:", JSON.stringify(batch?.[0] || data).slice(0, 1500));',
  '      /* Sensitive CDR sample logging removed. */',
  'remove-cdr-sample-log'
);
replaceOnce(
  '      console.log("VOICEMAIL SAMPLE RECORD:", JSON.stringify(data[0], null, 2));',
  '      /* Sensitive voicemail sample logging removed. */',
  'remove-voicemail-sample-log'
);
replaceOnce(
  '  console.log("Raw response:", JSON.stringify(data).slice(0, 2000));',
  '  /* Raw agent response logging removed. */',
  'remove-agent-raw-response-log'
);
const recipientBlock='  const recipients = String(body.recipients || "")\n    .split(",")\n    .map(e => e.trim())\n    .filter(Boolean);';
const recipientBlockHardened=recipientBlock+'\n\n  if (recipients.some(value => !isApprovedReportRecipient(value))) {\n    return json({ error: "Report recipients must use an approved corporate email domain." }, cors, 400);\n  }';
replaceWithin(
  'async function handleSaveFaxSchedule(request, env, cors) {',
  'async function handleGetFaxSchedule(request, env, cors) {',
  recipientBlock,recipientBlockHardened,'restrict-fax-recipients'
);
replaceWithin(
  'async function handleSaveVoicemailSchedule(request, env, cors) {',
  'async function handleDeleteVoicemailSchedule(request, env, cors) {',
  recipientBlock,recipientBlockHardened,'restrict-voicemail-recipients'
);

replaceWithin(
  'async function handleSaveAgentSettings(request, env, cors) {',
  'function normalizeList(data) {',
  '    ccRecipients: String(body.ccRecipients || "")\n      .split(",")\n      .map(e => e.trim())\n      .filter(Boolean),',
  '    ccRecipients: String(body.ccRecipients || "")\n      .split(",")\n      .map(e => e.trim())\n      .filter(Boolean)\n      .filter(isApprovedReportRecipient),',
  'restrict-agent-settings-recipients'
);
const requiredAfter=[
  'const PASSWORD_SCHEME = "pbkdf2-sha256-v1";',
  'legacySecurityRoutePolicy(path, method)',
  'mfa-setup-ticket-required',
  'safeUserForClient',
  'rules.length > 0 && isIpAllowedWithCidrs',
  'Sensitive CDR sample logging removed',
  'Sensitive voicemail sample logging removed',
  'Raw agent response logging removed',
  'WEBEX_DASHBOARD_BUILD',
  '/api/webex/daily-reports',
  '/api/webex/agent/auto-logout/run',
  '/api/fax/schedule/save',
  '/api/voicemails/schedule/save'
];
for(const needle of requiredAfter){if(!s.includes(needle))throw new Error('hardening preservation check failed: '+needle);}
if(s.includes('console.log("ALIANZA AUTH RESPONSE:", text)'))throw new Error('sensitive Alianza auth logging still present');
if(!s.includes('const users = (await loadAllUsers(env)).map(safeUserForClient);'))throw new Error('safe user-list projection missing');
replaceOnce(
  'async function createSession(env, username, role) {\n  const id = crypto.randomUUID();\n  await env.SESSIONS.put(id, JSON.stringify({\n    username,\n    role,\n    created: Date.now(),\n    expires: Date.now() + 12 * 3600 * 1000\n  }));\n  return id;\n}',
  'async function createSession(env, username, role) {\n  const id = crypto.randomUUID();\n  await env.SESSIONS.put(id, JSON.stringify({\n    username,\n    role,\n    created: Date.now(),\n    expires: Date.now() + 12 * 3600 * 1000\n  }), { expirationTtl: 12 * 3600 });\n  return id;\n}',
  'session-kv-ttl'
);

const hardenedSessionReader=String.raw`
async function getVisionBankSessionFromRequest(request, env) {
  const auth=String(request.headers.get("Authorization")||"");
  if(!auth.toLowerCase().startsWith("bearer "))return null;
  const sessionId=auth.slice(7).trim();
  if(!sessionId)return null;
  const raw=await env.SESSIONS.get(sessionId);
  if(!raw)return null;
  let session;try{session=JSON.parse(raw);}catch{return null;}
  if(!session?.expires||Number(session.expires)<=Date.now()){await env.SESSIONS.delete(sessionId);return null;}
  const username=normalizeUsername(session.username);
  const user=await getUser(env,username);
  if(!user||!(await isApprovedPortalEmail(user.email))){await env.SESSIONS.delete(sessionId);return null;}
  const role=String(user.role||session.role||"unknown").toLowerCase();
  if(!LEGACY_SECURITY_ROLES.has(role)){await env.SESSIONS.delete(sessionId);return null;}
  return {id:sessionId,username,role,expires:Number(session.expires)};
}
`;
replaceBetween(
  'async function getVisionBankSessionFromRequest(request, env) {',
  'async function authorizeWebexAgentRequest(request, env) {',
  hardenedSessionReader,
  'harden-session-reader'
);
if(!s.includes('{ expirationTtl: 12 * 3600 }'))throw new Error('security session KV TTL hardening missing');
if(!s.includes('const user=await getUser(env,username);'))throw new Error('security session account revalidation missing');
replaceWithin(
  'async function handleSetIpRules(request, env, cors) {',
  '/*******************************************************************************************\n * LOGGING',
  '    rules = rules\n      .map(r => r.trim())\n      .filter(r => r.length > 0 && validateRule(r) && !seen.has(r) && seen.add(r));',
  '    rules = rules\n      .map(r => r.trim())\n      .filter(r => r.length > 0 && validateRule(r) && !seen.has(r) && seen.add(r));\n\n    if (!rules.length) {\n      return json({ error: "At least one approved network rule is required." }, cors, 400);\n    }',
  'prevent-empty-allowlist'
);

fs.writeFileSync(output,s,'utf8');
console.log(JSON.stringify({input,output,bytes:Buffer.byteLength(s),status:'hardened'},null,2));
