(function () {
  "use strict";

  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location = window.self.location.href; } catch {}
  }

  function addLine(container, label, value) {
    const row = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = label;
    row.appendChild(strong);
    row.appendChild(document.createTextNode(" " + String(value || "Unknown")));
    container.appendChild(row);
  }

  function showDenied(overlay, message, text) {
    if (message) {
      message.replaceChildren();
      const strong = document.createElement("strong");
      strong.textContent = text || "Access has been restricted.";
      message.appendChild(strong);
    }
    overlay?.classList.remove("hidden");
    document.body.classList.remove("security-approved");
  }

  function renderDenied(overlay, message, data) {
    if (!message) return showDenied(overlay, message, "Access has been restricted.");
    const info = data?.info || {};
    const geo = info.geo || {};
    message.replaceChildren();

    const heading = document.createElement("strong");
    heading.textContent = "Access has been restricted.";
    message.appendChild(heading);
    message.appendChild(document.createElement("br"));
    message.appendChild(document.createElement("br"));

    const ip = info.primaryIp || "Unknown";
    const ipRow = document.createElement("div");
    const ipLabel = document.createElement("strong");
    ipLabel.textContent = "Primary IP:";
    ipRow.appendChild(ipLabel);
    ipRow.appendChild(document.createTextNode(" " + ip + " (" + (info.ipVersion || "Unknown") + ") "));
    const copy = document.createElement("button");
    copy.className = "copy-ip-btn";
    copy.type = "button";
    copy.textContent = "Copy IP";
    copy.addEventListener("click", () => navigator.clipboard?.writeText(ip).catch(() => {}));
    ipRow.appendChild(copy);
    message.appendChild(ipRow);

    if (info.forwardedFor) addLine(message, "Forwarded IP(s):", info.forwardedFor);
    addLine(message, "Location:", [geo.city || "Unknown", geo.region || "", geo.country || ""].filter(Boolean).join(", "));
    addLine(message, "Network:", (info.asOrg || "Unknown") + " (" + (info.asn ? "AS" + info.asn : "Unknown") + ")");
    message.appendChild(document.createElement("br"));
    message.appendChild(document.createTextNode("Please provide this information to the VisionBank IT Team."));

    overlay?.classList.remove("hidden");
    document.body.classList.remove("security-approved");
  }

  window.addEventListener("DOMContentLoaded", async () => {
    const overlay = document.getElementById("access-denied-overlay");
    const message = document.getElementById("access-denied-message");
    const status = document.getElementById("securityStatus");

    try {
      const response = await fetch("https://visionbank-security.ahmedadeyemi.workers.dev/security/check", {
        method: "GET",
        mode: "cors",
        credentials: "omit"
      });

      if (!response.ok) {
        showDenied(overlay, message, "Unable to contact security service (HTTP " + response.status + ").");
        return;
      }

      const data = await response.json();
      window.VB_SECURITY = data;

      if (!data.allowed) {
        renderDenied(overlay, message, data);
        return;
      }

      overlay?.classList.add("hidden");
      document.body.classList.add("security-approved");

      if (status && data.info) {
        const ip = data.info.primaryIp || "Unknown IP";
        let label = data.info.nowCst?.label;
        if (!label) {
          try {
            label = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" });
          } catch {
            label = new Date().toLocaleString();
          }
        }
        status.textContent = "Access approved from IP " + ip + " at " + label;
      }
    } catch (error) {
      console.error("Security check failed:", error);
      showDenied(overlay, message, "Unable to contact security service.");
    }

    const agentControls = document.getElementById("openAgentControls");
    agentControls?.addEventListener("click", () => { location.href = "webex-agent.html"; });
  });
})();