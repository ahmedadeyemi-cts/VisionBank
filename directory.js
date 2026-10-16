const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

const VB_SESSION_KEY = "vb_session";
const VB_USER_KEY = "vb_user";
const VB_ROLE_KEY = "vb_role";

function authHeaders(extra = {}) {
  return window.VBPortalSession?.authHeaders(extra) || extra;
}

async function revokePortalSession() {
  const session = window.VBPortalSession?.get() || "";
  if (!session) return;
  try {
    await fetch(`${SECURITY_BASE}/api/logout`, { method: "POST", headers: authHeaders() });
  } catch (err) {
    console.debug("Portal session revoke skipped:", err?.message || err);
  }
}

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");

const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const totpInput = document.getElementById("totpInput");
const loginBtn = document.getElementById("loginBtn");
const loginStatus = document.getElementById("loginStatus");

const logoutBtn = document.getElementById("logoutBtn");
const themeToggle = document.getElementById("themeToggle");

const totalContacts = document.getElementById("totalContacts");
const totalExtensions = document.getElementById("totalExtensions");
const totalPhones = document.getElementById("totalPhones");

const addContactBtn = document.getElementById("addContactBtn");
const saveDirectoryBtn = document.getElementById("saveDirectoryBtn");
const downloadCsvBtn = document.getElementById("downloadCsvBtn");
const downloadXmlBtn = document.getElementById("downloadXmlBtn");
const uploadCsvInput = document.getElementById("uploadCsvInput");

const directoryTableBody = document.getElementById("directoryTableBody");
const directoryStatus = document.getElementById("directoryStatus");
const searchName = document.getElementById("searchName");
const searchExtension = document.getElementById("searchExtension");
const locationFilter = document.getElementById("locationFilter");

let contacts = [];
let directoryRevision=null,directoryDirty=false;
const syncDirectoryBtn=document.getElementById('syncDirectoryBtn');
let lastDirectorySync=null;
function nextDirectorySync(after){
 const d=new Date(after);d.setUTCMinutes(17,0,0);d.setUTCHours(Math.floor(d.getUTCHours()/3)*3);
 if(d.getTime()<=after)d.setUTCHours(d.getUTCHours()+3);
 return d.getTime();
}
function showSyncStatus(sync){lastDirectorySync=sync;renderSyncClock();}
function renderSyncClock(){
 const el=document.getElementById('directorySyncStatus');if(!el)return;
 const sync=lastDirectorySync,now=Date.now();
 const format=t=>new Date(t).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'long'});
 const last=sync?.completedAt?format(sync.completedAt):'Not yet completed';
 const next=nextDirectorySync(sync?.completedAt||now),remaining=Math.max(0,Math.ceil((next-now)/1000));
 const countdown=remaining?`${Math.floor(remaining/3600)}h ${Math.floor(remaining%3600/60)}m ${remaining%60}s`:'Awaiting sync confirmation';
 document.getElementById('directoryLastSync').textContent=last;
 document.getElementById('directoryNextSync').textContent=format(next);
 document.getElementById('directorySyncCountdown').textContent=countdown;
 const intro='Runs every 3 hours. Times are shown in your local time zone. WG entries stay unchanged. FAX_, Contact Center RTMS and Voice Messaging Group entries are excluded. ';
 el.textContent=intro+(sync?.state==='error'?'Last attempt failed: '+sync.message+'. The last successful sync time is shown above.':sync?.completedAt?`${sync.added||0} added, ${sync.updated||0} updated, ${sync.deleted||0} removed. ${sync.protected||0} WG entries protected.`:'Waiting for the first successful sync.');
}
setInterval(renderSyncClock,1000);
// Read status only: never replace unsaved directory edits during background checks.
setInterval(async()=>{
 if(document.hidden||appView.classList.contains('hidden'))return;
 try{const response=await fetch(`${SECURITY_BASE}/api/directory/get`,{headers:authHeaders()});if(!response.ok)return;const data=await response.json();if(data.success)showSyncStatus(data.sync);}catch{/* Keep the last confirmed sync time. */}
},60000);
directoryTableBody?.addEventListener('input',()=>{directoryDirty=true;});
syncDirectoryBtn?.addEventListener('click',async()=>{
 if(directoryDirty){directoryStatus.textContent='Save your directory edits before syncing, or reload this page to discard them.';return;}
 const controls=[...appView.querySelectorAll('input,button,select')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
 directoryStatus.textContent='Syncing users and workspaces from Webex…';
 try{const response=await fetch(`${SECURITY_BASE}/api/directory/sync`,{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:'{}'});const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'Sync failed');
 contacts=data.contacts;directoryRevision=data.revision;directoryDirty=false;populateLocationFilter();renderDirectory();showSyncStatus(data.sync);directoryStatus.textContent='Sync complete. The phone directory has been updated.';
 }catch(error){directoryStatus.textContent='Unable to sync: '+error.message;}
 finally{controls.forEach(([el,disabled])=>el.disabled=disabled);}
});

// =====================================================
// SECURITY
// =====================================================
async function runSecurityCheck() {
  try {
    const res = await fetch(`${SECURITY_BASE}/security/check`);
    const data = await res.json();

    if (!data.allowed) {
      loginView.classList.remove("hidden");
      appView.classList.add("hidden");
      return false;
    }

    return true;
  } catch (err) {
    console.error(err);
    loginView.classList.remove("hidden");
    appView.classList.add("hidden");
    return false;
  }
}

loginBtn?.addEventListener("click", async () => {
  loginStatus.textContent = "Signing in...";

  try {
    const payload = {
      username: usernameInput.value.trim(),
      password: passwordInput.value,
      totp: totpInput.value.trim()
    };

    const res = await fetch(`${SECURITY_BASE}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || "Login failed.");
    }

    if (data.requireTotp) {
      loginStatus.textContent = "MFA code required.";
      return;
    }

    if (data.requireMfaSetup) {
      loginStatus.textContent = "MFA setup is required from the Security page.";
      return;
    }

    window.VBPortalSession?.set(data.session);
    localStorage.setItem(VB_USER_KEY, payload.username);
    localStorage.setItem(VB_ROLE_KEY, data.user?.role || "view");

    loginView.classList.add("hidden");
    appView.classList.remove("hidden");

    await loadDirectory();

  } catch (err) {
    console.error(err);
    loginStatus.textContent = err.message || "Unable to sign in.";
  }
});

logoutBtn?.addEventListener("click", async () => {
  await revokePortalSession();
  window.VBPortalSession?.clear();
  localStorage.removeItem(VB_USER_KEY);
  localStorage.removeItem(VB_ROLE_KEY);
  location.href = "security.html";
});

// =====================================================
// DIRECTORY LOAD / SAVE
// =====================================================
async function loadDirectory() {
  directoryStatus.textContent = "Loading directory...";

  try {
    const res = await fetch(`${SECURITY_BASE}/api/directory/get`, { headers: authHeaders() });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Unable to load directory.");
    }

    contacts = Array.isArray(data.contacts) ? data.contacts : [];
    directoryRevision=data.revision;directoryDirty=false;showSyncStatus(data.sync);
    populateLocationFilter();
    renderDirectory();

    directoryStatus.textContent = "Directory loaded.";
  } catch (err) {
    console.error(err);
    directoryStatus.textContent = "Unable to load directory.";
  }
}

async function saveDirectory() {
  collectContactsFromTable();

  directoryStatus.textContent = "Saving directory...";

  try {
    const res = await fetch(`${SECURITY_BASE}/api/directory/save`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ contacts, revision:directoryRevision })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Unable to save directory.");
    }

    contacts = Array.isArray(data.contacts) ? data.contacts : [];
    directoryRevision=data.revision;directoryDirty=false;showSyncStatus(data.sync);
    renderDirectory();

    directoryStatus.textContent = `Directory saved. ${data.count || contacts.length} contacts published.`;
  } catch (err) {
    console.error(err);
    directoryStatus.textContent = "Unable to save directory. "+err.message;
  }
}
function populateLocationFilter() {
  if (!locationFilter) return;

  const currentValue = locationFilter.value;

  const locations = [
    ...new Set(
      contacts
        .map(c => c.location || "")
        .filter(Boolean)
    )
  ].sort();

  locationFilter.innerHTML =
    `<option value="">All Locations</option>` +
    locations.map(location =>
      `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`
    ).join("");

  locationFilter.value = currentValue;
}
// =====================================================
// TABLE
// =====================================================
function renderDirectory() {
  if (!contacts.length) {
    directoryTableBody.innerHTML = `
  <tr class="empty-row">
    <td colspan="9" class="empty-cell">
      No contacts found. Add a contact or bulk upload a CSV.
    </td>
  </tr>
`;
    updateKpis();
    return;
  }

  directoryTableBody.innerHTML = contacts.map((contact, index) => `
   <tr data-index="${index}">
  <td><input class="cell-input contact-firstName" value="${escapeHtml(contact.firstName || "")}" placeholder="First Name" /></td>
  <td><input class="cell-input contact-lastName" value="${escapeHtml(contact.lastName || "")}" placeholder="Last Name" /></td>
  <td><input class="cell-input contact-name" value="${escapeHtml(contact.name || "")}" placeholder="Display Name" /></td>
  <td><input class="cell-input contact-extension" value="${escapeHtml(contact.extension || "")}" placeholder="5000" /></td>
  <td><input class="cell-input contact-phone" value="${escapeHtml(contact.phone || "")}" placeholder="5155551234" /></td>
  <td><input class="cell-input contact-email" value="${escapeHtml(contact.email || "")}" placeholder="user@visionbank.com" /></td>
  <td><input class="cell-input contact-location" value="${escapeHtml(contact.location || "")}" placeholder="Location" /></td>
  <td><input class="cell-input contact-notes" value="${escapeHtml(contact.notes || "")}" placeholder="Optional" /></td>
  <td><button class="btn-danger" type="button" data-directory-delete="${index}">Delete</button></td>
</tr>
  `).join("");

  updateKpis();
}

function collectContactsFromTable() {
  const rows = [...directoryTableBody.querySelectorAll("tr[data-index]")];

  contacts = rows.map(row => {
    const firstName = row.querySelector(".contact-firstName")?.value.trim() || "";
    const lastName = row.querySelector(".contact-lastName")?.value.trim() || "";
    const displayName = row.querySelector(".contact-name")?.value.trim() || `${firstName} ${lastName}`.trim();

    return {
      webexDirectoryId:contacts[Number(row.dataset.index)]?.webexDirectoryId,
      firstName,
      lastName,
      name: displayName,
      extension: onlyDigits(row.querySelector(".contact-extension")?.value || ""),
      phone: onlyDigits(row.querySelector(".contact-phone")?.value || ""),
      email: row.querySelector(".contact-email")?.value.trim() || "",
      location: row.querySelector(".contact-location")?.value.trim() || "",
      notes: row.querySelector(".contact-notes")?.value.trim() || ""
    };
  }).filter(c => c.name && (c.extension || c.phone));
}
function addContact() {
  directoryDirty=true;
  collectContactsFromTable();

  contacts.push({
  firstName: "",
  lastName: "",
  name: "",
  extension: "",
  phone: "",
  email: "",
  location: "",
  notes: ""
});

  renderDirectory();
}

function deleteContact(index) {
  directoryDirty=true;
  collectContactsFromTable();
  contacts.splice(index, 1);
  renderDirectory();
  directoryStatus.textContent = "Contact removed. Click Save Directory to publish changes.";
}

window.deleteContact = deleteContact;

directoryTableBody?.addEventListener("click", event => {
  const button = event.target.closest("button[data-directory-delete]");
  if (!button || !directoryTableBody.contains(button)) return;
  const index = Number.parseInt(button.dataset.directoryDelete || "", 10);
  if (Number.isInteger(index) && index >= 0) deleteContact(index);
});

// =====================================================
// BULK CSV
// =====================================================
function downloadCsv() {
  collectContactsFromTable();

  const headers = ["FirstName", "LastName", "Name", "Extension", "Phone", "Email", "Location", "Notes"];

  const rows = contacts.map(c => [
  c.firstName || "",
  c.lastName || "",
  c.name || "",
  c.extension || "",
  c.phone || "",
  c.email || "",
  c.location || "",
  c.notes || ""
]);

  const csv = [headers, ...rows]
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  downloadFile("VisionBank-Directory.csv", csv, "text/csv");
}

function downloadXml() {
  collectContactsFromTable();

  const entries = contacts.map(c => {
    let phones = "";

    if (c.extension) {
      phones += `    <Telephone>${xmlEscape(c.extension)}</Telephone>\n`;
    }

    if (c.phone) {
      phones += `    <Telephone>${xmlEscape(c.phone)}</Telephone>\n`;
    }

    return `  <DirectoryEntry>
    <Name>${xmlEscape(c.name)}</Name>
${phones}  </DirectoryEntry>`;
  }).join("\n");

  const xml = `<?xml version="1.0" ?>
<YealinkIPPhoneDirectory>
${entries}
</YealinkIPPhoneDirectory>`;

  downloadFile("directory.xml", xml, "application/xml");
}

uploadCsvInput?.addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  const imported = parseCsv(text);
  directoryDirty=true;

contacts = imported
  .map(row => {
    const firstName = row.FirstName || row.firstName || row.UserFirstName || "";
    const lastName = row.LastName || row.lastName || row.UserLastName || "";

    const name =
      row.Name ||
      row.name ||
      row.DisplayName ||
      row.displayName ||
      `${firstName} ${lastName}`.trim();

    return {
      firstName,
      lastName,
      name,
      extension: onlyDigits(row.Extension || row.extension || row.Ext || row.ext || ""),
      phone: onlyDigits(row.Phone || row.phone || row.CallerIdNumber || row.callerIdNumber || row.Number || row.number || ""),
      email: row.Email || row.email || row.UserEmailAddress || row.userEmailAddress || "",
      location: row.Location || row.location || row.Department || row.department || "",
      notes: row.Notes || row.notes || ""
    };
  })
  .filter(c => c.name && (c.extension || c.phone));

  populateLocationFilter();
renderDirectory();
directoryStatus.textContent = `Imported ${contacts.length} contacts. Click Save Directory to publish.`;

  uploadCsvInput.value = "";
});

function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter(line => line.trim());

  if (!lines.length) return rows;

  const headers = splitCsvLine(lines[0]).map(h => h.trim());

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    rows.push(row);
  }

  return rows;
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
function filterDirectory() {
  const nameValue = (searchName?.value || "").toLowerCase().trim();
  const extensionValue = (searchExtension?.value || "").trim();
  const locationValue = locationFilter?.value || "";

  const rows = directoryTableBody.querySelectorAll("tr[data-index]");

  rows.forEach(row => {
    const firstName =
      row.querySelector(".contact-firstName")?.value.toLowerCase() || "";

    const lastName =
      row.querySelector(".contact-lastName")?.value.toLowerCase() || "";

    const displayName =
      row.querySelector(".contact-name")?.value.toLowerCase() || "";

    const extension =
      row.querySelector(".contact-extension")?.value || "";

    const phone =
      row.querySelector(".contact-phone")?.value || "";

    const email =
      row.querySelector(".contact-email")?.value.toLowerCase() || "";

    const location =
      row.querySelector(".contact-location")?.value || "";

    const nameMatch =
      !nameValue ||
      firstName.includes(nameValue) ||
      lastName.includes(nameValue) ||
      displayName.includes(nameValue) ||
      email.includes(nameValue);

    const extensionMatch =
      !extensionValue ||
      extension.includes(extensionValue) ||
      phone.includes(extensionValue);

    const locationMatch =
      !locationValue ||
      location === locationValue;

    row.style.display =
      nameMatch && extensionMatch && locationMatch
        ? ""
        : "none";
  });
}
// =====================================================
// HELPERS
// =====================================================
function updateKpis() {
  const extensionCount = contacts.filter(c => c.extension).length;
  const phoneCount = contacts.filter(c => c.phone).length;

  totalContacts.textContent = contacts.length;
  totalExtensions.textContent = extensionCount;
  totalPhones.textContent = phoneCount;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

// =====================================================
// THEME
// =====================================================
themeToggle?.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("vb_theme", document.body.classList.contains("dark") ? "dark" : "light");
});

function restoreTheme() {
  const theme = localStorage.getItem("vb_theme");
  if (theme === "dark") {
    document.body.classList.add("dark");
  }
}

// =====================================================
// EVENTS
// =====================================================
addContactBtn?.addEventListener("click", addContact);
saveDirectoryBtn?.addEventListener("click", saveDirectory);
downloadCsvBtn?.addEventListener("click", downloadCsv);
downloadXmlBtn?.addEventListener("click", downloadXml);
searchName?.addEventListener("input", filterDirectory);
searchExtension?.addEventListener("input", filterDirectory);
locationFilter?.addEventListener("change", filterDirectory);

// =====================================================
// INIT
// =====================================================
(async function init() {
  restoreTheme();

  const existingSession = window.VBPortalSession?.get();

  if (existingSession) {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
  } else {
    loginView.classList.remove("hidden");
    appView.classList.add("hidden");
  }

  const allowed = await runSecurityCheck();
  if (!allowed) return;

  if (existingSession) {
    await loadDirectory();
  }
})();
