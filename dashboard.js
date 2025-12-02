document.addEventListener("DOMContentLoaded", () => {

    /* ======================================================
       NOTIFICATION PERMISSIONS
    ====================================================== */
    if (Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    /* ======================================================
       ELEMENTS
    ====================================================== */
    const queueBody = document.getElementById("queue-body");
    const agentBody = document.getElementById("agent-body");

    const alertSettingsToggle = document.getElementById("alertSettingsToggle");
    const alertSettingsPanel = document.getElementById("alertSettingsPanel");
    const alertHistoryToggle = document.getElementById("alertHistoryToggle");
    const alertHistoryPanel = document.getElementById("alertHistoryPanel");

    const alertTestButton = document.getElementById("alertTestButton");
    const clearAlertHistory = document.getElementById("clearAlertHistory");
    const alertHistoryList = document.getElementById("alertHistoryList");

    const enableQueueAlerts = document.getElementById("enableQueueAlerts");
    const enableVoiceAlerts = document.getElementById("enableVoiceAlerts");
    const enablePopupAlerts = document.getElementById("enablePopupAlerts");
    const alertToneSelect = document.getElementById("alertToneSelect");
    const alertCooldownInput = document.getElementById("alertCooldown");
    const alertVolumeSlider = document.getElementById("alertVolume");

    const alertAudio = document.getElementById("alertAudio");

    let lastAlertTime = 0;
    let alertHistory = [];

    /* ======================================================
       API CALL — THIS IS THE CORRECT WORKING VERSION (B)
    ====================================================== */
    async function fetchApi(endpoint) {
        try {
            const res = await fetch(endpoint, {
                headers: {
                    Authorization: "Bearer VisionBankUSSignalSuperToken123!"
                }
            });
            return await res.json();
        } catch (err) {
            console.error("API ERROR:", err);
            return null;
        }
    }

    /* ======================================================
       TOGGLES
    ====================================================== */
    alertSettingsToggle.addEventListener("click", () => {
        alertSettingsPanel.classList.toggle("hidden");
        alertHistoryPanel.classList.add("hidden");
    });

    alertHistoryToggle.addEventListener("click", () => {
        alertHistoryPanel.classList.toggle("hidden");
        alertSettingsPanel.classList.add("hidden");
    });

    /* ======================================================
       FETCH QUEUES
    ====================================================== */
    async function fetchQueueStatus() {
        const data = await fetchApi("/api/queueStatus");

        if (!data || !Array.isArray(data)) {
            queueBody.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
            return;
        }

        updateQueueTable(data);
        updateToneOverrides(data);
    }

    /* ======================================================
       UPDATE QUEUE TABLE
    ====================================================== */
    function updateQueueTable(queues) {
        queueBody.innerHTML = "";

        if (!queues.length) {
            queueBody.innerHTML = `<tr><td colspan="5" class="loading">No queue data found.</td></tr>`;
            return;
        }

        queues.forEach(queue => {
            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${queue.name}</td>
                <td class="queue-calls">${queue.calls}</td>
                <td>${queue.agents}</td>
                <td>${queue.maxWait}</td>
                <td>${queue.avgWait}</td>
            `;

            // 🔥 IF CALLS > 0 → RED / WHITE TEXT + ALERTS
            if (Number(queue.calls) > 0) {
                tr.classList.add("queue-hot");
                triggerAlerts(queue);

                tr.querySelector(".queue-calls").style.background = "#c0392b";
                tr.querySelector(".queue-calls").style.color = "#ffffff";
                tr.querySelector(".queue-calls").style.fontWeight = "bold";
                tr.querySelector(".queue-calls").style.borderRadius = "4px";
            }

            queueBody.appendChild(tr);
        });
    }

    /* ======================================================
       UPDATE TONE OVERRIDES
    ====================================================== */
    function updateToneOverrides(queues) {
        const container = document.getElementById("queueToneOverrides");
        container.innerHTML = "";

        if (!queues.length) {
            container.innerHTML = `<div class="queue-override-empty">No queues loaded yet.</div>`;
            return;
        }

        queues.forEach(queue => {
            const row = document.createElement("div");
            row.className = "queue-override-row";

            row.innerHTML = `
                <span class="queue-override-label">${queue.name}</span>
                <select class="queue-override-select" data-queue="${queue.name}">
                    <option value="soft">Soft chime</option>
                    <option value="bright">Bright bell</option>
                    <option value="pulse">Pulse beep</option>
                </select>
            `;

            container.appendChild(row);
        });
    }

    /* ======================================================
       FETCH AGENT STATUS
    ====================================================== */
    async function fetchAgentStatus() {
        const data = await fetchApi("/api/agentStatus");

        if (!data || !Array.isArray(data)) {
            agentBody.innerHTML = `<tr><td colspan="11" class="loading">Unable to load agent data.</td></tr>`;
            return;
        }

        updateAgentTable(data);
    }

    /* ======================================================
       AVAILABILITY COLOR LOGIC
       (This restores your original colors including GREEN Available)
    ====================================================== */
    function availabilityClass(status) {
        if (!status) return "";

        const normalized = status.toLowerCase();

        if (normalized.includes("available")) return "status-available";
        if (normalized.includes("not set")) return "status-orange";
        if (normalized.includes("wrap")) return "status-wrap";
        if (normalized.includes("lunch")) return "status-lunch";
        if (normalized.includes("break")) return "status-break";
        if (normalized.includes("on call")) return "status-oncall";
        if (normalized.includes("idle")) return "status-idle";

        return "";
    }

    /* ======================================================
       UPDATE AGENT TABLE
    ====================================================== */
    function updateAgentTable(agents) {
        agentBody.innerHTML = "";

        if (!agents.length) {
            agentBody.innerHTML = `<tr><td colspan="11" class="loading">No agent data found.</td></tr>`;
            return;
        }

        agents.forEach(agent => {
            const tr = document.createElement("tr");

            const statusClass = availabilityClass(agent.status);

            tr.innerHTML = `
                <td>${agent.name}</td>
                <td>${agent.team}</td>
                <td>${agent.ext}</td>
                <td><span class="availability-cell ${statusClass}">${agent.status}</span></td>
                <td>${agent.duration}</td>
                <td>${agent.inbound}</td>
                <td>${agent.missed}</td>
                <td>${agent.transferred}</td>
                <td>${agent.outbound}</td>
                <td>${agent.avgHandle}</td>
                <td>${agent.start}</td>
            `;

            agentBody.appendChild(tr);
        });
    }

    /* ======================================================
       ALERT TRIGGER LOGIC
    ====================================================== */
    function triggerAlerts(queue) {
        const now = Date.now();
        const cooldown = Number(alertCooldownInput.value) * 1000;

        if (!enableQueueAlerts.checked) return;
        if (now - lastAlertTime < cooldown) return;

        lastAlertTime = now;

        playTone();
        if (enableVoiceAlerts.checked) playVoice();
        if (enablePopupAlerts.checked) showPopup();
        sendBrowserNotification(queue);
        addToAlertHistory(queue);
    }

    /* ======================================================
       PLAY ALERT TONE
    ====================================================== */
    function playTone() {
        let toneFile = "assets/soft.mp3";

        if (alertToneSelect.value === "bright") toneFile = "assets/bright.mp3";
        if (alertToneSelect.value === "pulse") toneFile = "assets/pulse.mp3";

        alertAudio.src = toneFile;
        alertAudio.volume = alertVolumeSlider.value / 100;
        alertAudio.currentTime = 0;
        alertAudio.play();
    }

    /* ======================================================
       PLAY VOICE
    ====================================================== */
    function playVoice() {
        const voice = new Audio("assets/ttsAlert.mp3");
        voice.volume = alertVolumeSlider.value / 100;
        voice.play();
    }

    /* ======================================================
       POPUP
    ====================================================== */
    function showPopup() {
        const popup = document.createElement("div");
        popup.className = "queue-alert-popup";
        popup.textContent = "🚨 Calls waiting in queue!";
        document.body.appendChild(popup);

        setTimeout(() => popup.classList.add("visible"), 50);

        setTimeout(() => {
            popup.classList.remove("visible");
            setTimeout(() => popup.remove(), 250);
        }, 2000);
    }

    /* ======================================================
       BROWSER NOTIFICATION
    ====================================================== */
    function sendBrowserNotification(queue) {
        if (Notification.permission !== "granted") return;

        new Notification("Calls Waiting", {
            body: `Queue: ${queue.name}
Calls: ${queue.calls}
Agents: ${queue.agents}`,
            icon: "assets/VisionBank-Logo.png"
        });
    }

    /* ======================================================
       ALERT HISTORY
    ====================================================== */
    function addToAlertHistory(queue) {

        const entry = {
            time: new Date().toLocaleString(),
            calls: queue.calls,
            agents: queue.agents,
            tone: alertToneSelect.value,
            voice: enableVoiceAlerts.checked ? "Yes" : "No"
        };

        alertHistory.unshift(entry);
        renderHistory();
    }

    function renderHistory() {
        alertHistoryList.innerHTML = "";

        if (!alertHistory.length) {
            alertHistoryList.innerHTML = `<div class="history-empty">No alerts yet.</div>`;
            return;
        }

        alertHistory.forEach(item => {
            const div = document.createElement("div");
            div.className = "history-item";

            div.innerHTML = `
                <div class="history-time">${item.time}</div>
                Calls: ${item.calls}<br>
                Agents: ${item.agents}<br>
                Tone: ${item.tone}<br>
                Voice: ${item.voice}
            `;
            alertHistoryList.appendChild(div);
        });
    }

    clearAlertHistory.addEventListener("click", () => {
        alertHistory = [];
        renderHistory();
    });

    /* ======================================================
       TEST ALERT BUTTON
    ====================================================== */
    alertTestButton.addEventListener("click", () => {
        playTone();
        if (enableVoiceAlerts.checked) playVoice();
        showPopup();

        alertHistory.unshift({
            time: new Date().toLocaleString(),
            calls: "TEST",
            agents: "TEST",
            tone: alertToneSelect.value,
            voice: enableVoiceAlerts.checked ? "Yes" : "No"
        });

        renderHistory();
    });

    /* ======================================================
       POLLING
    ====================================================== */
    fetchQueueStatus();
    fetchAgentStatus();

    setInterval(fetchQueueStatus, 6000);
    setInterval(fetchAgentStatus, 8000);

});
