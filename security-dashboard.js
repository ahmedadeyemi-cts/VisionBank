/* ============================================================
   VisionBank Security Portal - Admin Dashboard
   ============================================================ */

(function () {
    function readJSON(key, fallback) {
        try {
            const stored = localStorage.getItem(key);
            return stored ? JSON.parse(stored) : fallback;
        } catch {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function formatDayName(idx) {
        const map = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return map[idx] || "?";
    }

    window.initSecurityDashboard = function (root) {
        if (!root) return;

        const cfg = window.SEC_CONFIG;
        const keys = cfg.storageKeys;

        // --- state ---
        const allowedIPs = readJSON(keys.allowedIPs, [
            "10.100.100.0/24",
            "45.19.161.17",
            "45.19.162.18/32",
            "120.112.1.119/28"
        ]);

        const defaultHours = {
            start: "07:00",
            end: "19:00",
            days: ["1", "2", "3", "4", "5", "6"] // Mon-Sat
        };

        const hours = readJSON(keys.businessHours, defaultHours);
        const auditLog = (window.VB_SECURITY && window.VB_SECURITY.loadAudit())
            || [];

        const adminProfile = readJSON(keys.adminProfile, { id: "superadmin" });

        // --- layout ---
        root.innerHTML = `
            <div class="vb-shell">
                <section class="vb-dashboard">
                    <header class="vb-dashboard-header">
                        <div>
                            <h2>Security Control Center</h2>
                            <div class="vb-small">
                                Manage IP access rules, business hours and audit log.
                            </div>
                        </div>
                        <div>
                            <span class="vb-user-chip">
                                Signed in as ${adminProfile.id || "superadmin"}
                            </span>
                            <button id="vb-btn-logout"
                                    class="vb-btn-secondary"
                                    style="margin-left:8px;">
                                Log out
                            </button>
                        </div>
                    </header>

                    <div class="vb-grid">
                        <!-- Access Control -->
                        <section class="vb-panel">
                            <h3>Access Control (IP / CIDR)</h3>
                            <p class="vb-small">
                                Only these IPs or ranges are permitted to access
                                the realtime dashboard.
                            </p>

                            <ul id="vb-ip-list" class="vb-ip-list"></ul>

                            <div class="vb-field">
                                <label for="vb-new-ip">Add new IP / CIDR</label>
                                <input id="vb-new-ip"
                                       class="vb-input"
                                       placeholder="Example: 10.100.100.0/24" />
                            </div>
                            <button id="vb-btn-add-ip"
                                    class="vb-btn-primary">
                                Add IP / Range
                            </button>
                        </section>

                        <!-- Business Hours -->
                        <section class="vb-panel">
                            <h3>Business Hours</h3>
                            <p class="vb-small">
                                Access outside business hours will be blocked unless
                                an admin override is used.
                            </p>

                            <div class="vb-field">
                                <label>Start time (CST)</label>
                                <input type="time"
                                       id="vb-hours-start"
                                       class="vb-input"
                                       value="${hours.start || "07:00"}" />
                            </div>
                            <div class="vb-field">
                                <label>End time (CST)</label>
                                <input type="time"
                                       id="vb-hours-end"
                                       class="vb-input"
                                       value="${hours.end || "19:00"}" />
                            </div>

                            <div class="vb-field">
                                <label>Active days</label>
                                <div>
                                    ${[1,2,3,4,5,6,0].map(d => {
                                        const checked = (hours.days || []).includes(String(d))
                                            ? "checked" : "";
                                        return `
                                            <label class="vb-small" style="margin-right:8px;">
                                                <input type="checkbox"
                                                       class="vb-day"
                                                       value="${d}"
                                                       ${checked} />
                                                ${formatDayName(d)}
                                            </label>
                                        `;
                                    }).join("")}
                                </div>
                            </div>

                            <button id="vb-btn-save-hours"
                                    class="vb-btn-primary">
                                Save Business Hours
                            </button>
                        </section>

                        <!-- Audit Log -->
                        <section class="vb-panel">
                            <h3>Audit Trail</h3>
                            <p class="vb-small">
                                Last ${Math.min(40, auditLog.length)} security events.
                            </p>
                            <ul id="vb-audit-log" class="vb-audit-log"></ul>
                            <button id="vb-btn-clear-audit"
                                    class="vb-btn-secondary"
                                    style="margin-top:8px;">
                                Clear audit log
                            </button>
                        </section>
                    </div>
                </section>
            </div>
        `;

        // ----- Render lists -----
        const ipListEl = document.getElementById("vb-ip-list");
        const auditEl = document.getElementById("vb-audit-log");

        function renderIPs() {
            ipListEl.innerHTML = "";
            if (!allowedIPs.length) {
                ipListEl.innerHTML = `<li class="vb-small">No IPs configured.</li>`;
                return;
            }
            allowedIPs.forEach((ip, idx) => {
                const li = document.createElement("li");
                li.innerHTML = `
                    <span class="vb-pill">${ip}</span>
                    <button data-idx="${idx}"
                            class="vb-btn-secondary"
                            style="font-size:11px;padding:2px 6px;">
                        Remove
                    </button>
                `;
                ipListEl.appendChild(li);
            });
        }

        function renderAudit() {
            auditEl.innerHTML = "";
            if (!auditLog.length) {
                auditEl.innerHTML = `<li class="vb-small">No events recorded yet.</li>`;
                return;
            }
            auditLog.slice(0, 40).forEach((entry) => {
                const li = document.createElement("li");
                li.textContent = entry;
                auditEl.appendChild(li);
            });
        }

        renderIPs();
        renderAudit();

        // ----- Event wiring -----
        document
            .getElementById("vb-btn-add-ip")
            .addEventListener("click", () => {
                const inp = document.getElementById("vb-new-ip");
                const val = (inp.value || "").trim();
                if (!val) return;
                if (allowedIPs.includes(val)) {
                    alert("That entry already exists.");
                    return;
                }
                allowedIPs.push(val);
                writeJSON(keys.allowedIPs, allowedIPs);
                if (window.VB_SECURITY) {
                    window.VB_SECURITY.addAudit(`Added allowed IP '${val}'.`);
                }
                inp.value = "";
                renderIPs();
            });

        ipListEl.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-idx]");
            if (!btn) return;
            const idx = parseInt(btn.dataset.idx, 10);
            const removed = allowedIPs.splice(idx, 1)[0];
            writeJSON(keys.allowedIPs, allowedIPs);
            if (window.VB_SECURITY) {
                window.VB_SECURITY.addAudit(`Removed allowed IP '${removed}'.`);
            }
            renderIPs();
        });

        document
            .getElementById("vb-btn-save-hours")
            .addEventListener("click", () => {
                const start = document.getElementById("vb-hours-start").value || "07:00";
                const end = document.getElementById("vb-hours-end").value || "19:00";
                const days = Array.from(
                    document.querySelectorAll(".vb-day:checked")
                ).map((cb) => cb.value);

                const newHours = { start, end, days };
                writeJSON(keys.businessHours, newHours);
                if (window.VB_SECURITY) {
                    window.VB_SECURITY.addAudit(
                        `Updated business hours to ${start}–${end} CST, days: ${days.join(",")}.`
                    );
                }
                alert("Business hours updated.");
            });

        document
            .getElementById("vb-btn-clear-audit")
            .addEventListener("click", () => {
                if (!confirm("Clear the entire audit log?")) return;
                if (window.VB_SECURITY) {
                    window.VB_SECURITY.addAudit("Audit log cleared by admin.");
                }
                localStorage.setItem(keys.auditLog, "[]");
                auditLog.length = 0;
                renderAudit();
            });

        document
            .getElementById("vb-btn-logout")
            .addEventListener("click", () => {
                sessionStorage.removeItem(keys.authSession);
                location.reload();
            });
    };
})();
