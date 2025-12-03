// =======================================
// VisionBank Security Dashboard (admin UI)
// =======================================

function initSecurityDashboard() {
  const hours = loadBusinessHours();
  const ips = loadAllowedIPs();

  // ---- Business hours UI ----
  const startEl = document.getElementById("bh-start");
  const endEl = document.getElementById("bh-end");
  const daysEls = Array.from(document.querySelectorAll(".bh-day"));
  const bhStatus = document.getElementById("bh-status");

  if (startEl) startEl.value = hours.start || "07:00";
  if (endEl) endEl.value = hours.end || "19:00";
  if (daysEls.length > 0 && Array.isArray(hours.days)) {
    daysEls.forEach(cb => {
      cb.checked = hours.days.includes(cb.value);
    });
  }

  const btnSaveHours = document.getElementById("btn-save-hours");
  if (btnSaveHours) {
    btnSaveHours.addEventListener("click", (e) => {
      e.preventDefault();
      const newHours = {
        start: startEl ? (startEl.value || "07:00") : "07:00",
        end: endEl ? (endEl.value || "19:00") : "19:00",
        days: daysEls.filter(cb => cb.checked).map(cb => cb.value)
      };
      saveBusinessHours(newHours);
      if (bhStatus) {
        bhStatus.textContent = "Business hours saved.";
        setTimeout(() => (bhStatus.textContent = ""), 2500);
      }
      populateAuditBox();
    });
  }

  // ---- IP ranges UI ----
  const ipTextarea = document.getElementById("ip-ranges");
  const ipStatus = document.getElementById("ip-status");
  if (ipTextarea && Array.isArray(ips)) {
    ipTextarea.value = ips.join("\n");
  }

  const btnSaveIps = document.getElementById("btn-save-ips");
  if (btnSaveIps) {
    btnSaveIps.addEventListener("click", (e) => {
      e.preventDefault();
      if (!ipTextarea) return;
      const lines = ipTextarea.value
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(x => x.length > 0);
      saveAllowedIPs(lines);
      if (ipStatus) {
        ipStatus.textContent = "Allowed IP ranges saved.";
        setTimeout(() => (ipStatus.textContent = ""), 2500);
      }
      populateAuditBox();
    });
  }

  populateAuditBox();
}
