const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

const VB_SESSION_KEY = "vb_session";
const VB_USER_KEY = "vb_user";
const VB_ROLE_KEY = "vb_role";

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

let contacts = [];

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

    localStorage.setItem(VB_SESSION_KEY, data.session);
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

logoutBtn?.addEventListener("click", () => {
  localStorage.removeItem(VB_SESSION_KEY);
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
    const res = await fetch(`${SECURITY_BASE}/api/directory/get`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Unable to load directory.");
    }

    contacts = Array.isArray(data.contacts) ? data.contacts : [];
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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ contacts })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Unable to save directory.");
    }

    contacts = Array.isArray(data.contacts) ? data.contacts : [];
    renderDirectory();

    directoryStatus.textContent = `Directory saved. ${data.count || contacts.length} contacts published.`;
  } catch (err) {
    console.error(err);
    directoryStatus.textContent = "Unable to save directory.";
  }
}

// =====================================================
// TABLE
// =====================================================
function renderDirectory() {
  if (!contacts.length) {
    directoryTableBody.innerHTML = `
      <tr>
        <td colspan="5">No contacts found. Add a contact or bulk upload a CSV.</td>
      </tr>
    `;
    updateKpis();
    return;
  }

  directoryTableBody.innerHTML = contacts.map((contact, index) => `
    <tr data-index="${index}">
      <td>
        <input class="cell-input contact-name" value="${escapeHtml(contact.name || "")}" placeholder="Contact Name" />
      </td>
      <td>
        <input class="cell-input contact-extension" value="${escapeHtml(contact.extension || "")}" placeholder="5000" />
      </td>
      <td>
        <input class="cell-input contact-phone" value="${escapeHtml(contact.phone || "")}" placeholder="5155551234" />
      </td>
      <td>
        <input class="cell-input contact-notes" value="${escapeHtml(contact.notes || contact.department || "")}" placeholder="Optional" />
      </td>
      <td>
        <button class="btn-danger" onclick="deleteContact(${index})">Delete</button>
      </td>
    </tr>
  `).join("");

  updateKpis();
}

function collectContactsFromTable() {
  const rows = [...directoryTableBody.querySelectorAll("tr[data-index]")];

  contacts = rows.map(row => {
    return {
      name: row.querySelector(".contact-name")?.value.trim() || "",
      extension: onlyDigits(row.querySelector(".contact-extension")?.value || ""),
      phone: onlyDigits(row.querySelector(".contact-phone")?.value || ""),
      notes: row.querySelector(".contact-notes")?.value.trim() || ""
    };
  }).filter(c => c.name && (c.extension || c.phone));
}

function addContact() {
  collectContactsFromTable();

  contacts.push({
    name: "",
    extension: "",
    phone: "",
    notes: ""
  });

  renderDirectory();
}

function deleteContact(index) {
  collectContactsFromTable();
  contacts.splice(index, 1);
  renderDirectory();
  directoryStatus.textContent = "Contact removed. Click Save Directory to publish changes.";
}

window.deleteContact = deleteContact;

// =====================================================
// BULK CSV
// =====================================================
function downloadCsv() {
  collectContactsFromTable();

  const headers = ["Name", "Extension", "Phone", "Notes"];

  const rows = contacts.map(c => [
    c.name || "",
    c.extension || "",
    c.phone || "",
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

  contacts = imported
    .map(row => ({
      name: row.Name || row.name || row.Contact || row.contact || "",
      extension: onlyDigits(row.Extension || row.extension || row.Ext || row.ext || ""),
      phone: onlyDigits(row.Phone || row.phone || row.Number || row.number || ""),
      notes: row.Notes || row.notes || row.Department || row.department || ""
    }))
    .filter(c => c.name && (c.extension || c.phone));

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

// =====================================================
// INIT
// =====================================================
(async function init() {
  restoreTheme();

  const existingSession = localStorage.getItem(VB_SESSION_KEY);

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
