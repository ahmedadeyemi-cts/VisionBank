// security-dashboard.js
// Handles admin console configuration UI (IP list, business hours, PIN, audit).

(function () {
  "use strict";

  const STORAGE = {
    IP: "vb_ceg_ip_allowlist",
    HOURS: "vb_ceg_business_hours"
  };

  const DEFAULT_HOURS = {
    start: "07:00",
    end: "19:00",
    days: ["1", "2", "3", "4", "5", "6"] // Mon-Sat
  };

  function readJson(key, fallback) {
    try {
      const val = localStorage.getItem(key);
      if (!val) return fallback;
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, obj) {
    localStorage.setItem(key, JSON.stringify(obj));
  }

  function loadIpAllowlist() {
    const textarea = document.getElementById("ipAllowlist");
    if (!textarea) return;

    const raw = localStorage.getItem(STORAGE.IP) || "";
    textarea.value = raw;
  }

  function saveIpAllowlist(username) {
    const textarea = document.getElementById("ipAllowlist");
    const status = document.getElementById("ipSaveStatus");
    if (!textarea || !status) return;

    const val = textarea.value.trim();
    localStorage.setItem(STORAGE.IP, val);

    status.textContent = "IP allowlist saved locally.";
    setTimeout(() => (status.textContent = ""), 4000);

    if (window.VB_SECURITY?.addAudit) {
      window.VB_SECURITY.addAudit(
        `IP allowlist updated by "${username || "unknown"}"`
      );
    }
  }

  function loadBusinessHours() {
    const startInput = document.getElementById("bizStart");
    const endInput = document.getElementById("bizEnd");
    const dayCheckboxes = Array.from(document.querySelectorAll(".biz-day"));

    if (!startInput || !endInput) return;

    const cfg = readJson(STORAGE.HOURS, DEFAULT_HOURS);

    startInput.value = cfg.start || DEFAULT_HOURS.start;
    endInput.value = cfg.end || DEFAULT_HOURS.end;

    const days = cfg.days || DEFAULT_HOURS.days;

    dayCheckboxes.forEach((cb) => {
      cb.checked = days.includes(cb.value);
    });
  }

  function saveBusinessHours(username) {
    const startInput = document.getElementById("bizStart");
    const endInput = document.getElementById("bizEnd");
    const dayCheckboxes = Array.from(document.querySelectorAll(".biz-day"));
    const status = document.getElementById("bizSaveStatus");

    if (!startInput || !endInput || !status) return;

    const start = startInput.value || DEFAULT_HOURS.start;
    const end = endInput.value || DEFAULT_HOURS.end;
    const days = dayCheckboxes
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);

    const cfg = { start, end, days };
    writeJson(STORAGE.HOURS, cfg);

    status.textContent = "Business hours saved locally.";
    setTimeout(() => (status.textContent = ""), 4000);

    if (window.VB_SECURITY?.addAudit) {
      window.VB_SECURITY.addAudit(
        `Business hours updated by "${username || "unknown"}"`
      );
    }
  }

  function loadAuditLog() {
    const area = document.getElementById("auditLog");
    if (!area || !window.VB_SECURITY?.readAudit) return;
    const entries = window.VB_SECURITY.readAudit();
    area.value = entries.join("\n");
  }

  function initAuditControls() {
    const area = document.getElementById("auditLog");
    const btnClear = document.getElementById("clearAudit");
    if (!area || !btnClear) return;

    btnClear.addEventListener("click", () => {
      if (!window.confirm("Clear local audit log in this browser?")) return;
      if (window.VB_SECURITY?.addAudit) {
        window.VB_SECURITY.addAudit("Local audit log cleared from UI");
      }
      if (window.VB_SECURITY?.readAudit) {
        const entries = window.VB_SECURITY.readAudit();
        // keep record but mark event
        area.value = entries.join("\n");
      }
      // actually clear stored entries
      localStorage.setItem("vb_ceg_audit", "[]");
      area.value = "";
    });
  }

  function initPinChange(username) {
    const newPin = document.getElementById("newPin");
    const confirmPin = document.getElementById("confirmPin");
    const btn = document.getElementById("savePin");
    const status = document.getElementById("pinSaveStatus");

    if (!newPin || !confirmPin || !btn || !status) return;

    btn.addEventListener("click", () => {
      status.textContent = "";

      const p1 = newPin.value.trim();
      const p2 = confirmPin.value.trim();

      if (!p1 || !p2) {
        status.textContent = "Enter and confirm the new PIN.";
        status.style.color = "#b91c1c";
        return;
      }

      if (p1 !== p2) {
        status.textContent = "PINs do not match.";
        status.style.color = "#b91c1c";
        return;
      }

      if (p1.length < 6) {
        status.textContent = "Use at least 6 characters for the PIN.";
        status.style.color = "#b91c1c";
        return;
      }

      if (!window.VB_SECURITY?.updateAdmin) {
        status.textContent = "Unable to update admin record.";
        status.style.color = "#b91c1c";
        return;
      }

      window.VB_SECURITY.updateAdmin(username, (admin) => ({
        ...admin,
        pin: p1
      }));

      newPin.value = "";
      confirmPin.value = "";

      status.textContent = "PIN updated for current admin.";
      status.style.color = "#059669";

      if (window.VB_SECURITY?.addAudit) {
        window.VB_SECURITY.addAudit(
          `PIN changed for admin "${username || "unknown"}"`
        );
      }

      setTimeout(() => (status.textContent = ""), 4000);
    });
  }

  // Main entry – called by security.js after successful login
  window.initSecurityDashboard = function (session) {
    const username = session?.username || "unknown";

    loadIpAllowlist();
    loadBusinessHours();
    loadAuditLog();
    initAuditControls();
    initPinChange(username);

    const ipBtn = document.getElementById("saveIpRules");
    if (ipBtn) {
      ipBtn.onclick = () => saveIpAllowlist(username);
    }

    const bizBtn = document.getElementById("saveBizHours");
    if (bizBtn) {
      bizBtn.onclick = () => saveBusinessHours(username);
    }
  };
})();
