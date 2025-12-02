document.addEventListener("DOMContentLoaded", () => {

    /* ===============================
       REQUEST NOTIFICATION PERMISSION
       =============================== */
    if (Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    /* ===============================
       ELEMENTS
       =============================== */
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

    /* ===============================
       TOGGLES
       =============================== */
    alertSettingsToggle.addEventListener("click", () => {
        alertSettingsPanel.classList.toggle("hidden");
        alertHistoryPanel.classList.add("hidden");
    });

    alertHistoryToggle.addEventListener("click", () => {
        alertHistoryPanel.classList.toggle("hidden");
        alertSettingsPanel.classList.add("hidden");
    });

    /* ===============================
       FETCH QUEUE DATA
       =============================== */
    async function fetchQueueStatus() {
        try {
            const res = await fetch("/api/queueStatus");
            const data = await res.json();
            updateQueueTable(data);
            updateToneOverrides(data);
        } catch (err) {
            queueBody.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
        }
    }

    /* ===============================
       UPDATE QUEUE TABLE
       =============================== */
    function updateQueueTable(queues) {
        queueBody.innerHTML = "";

        if (!queues || queues.length === 0) {
            queueBody.innerHTML = `<tr><td colspan="5" class="loading">No queue data found.</td></tr>`;
            return;
        }

        queues.forEach(queue => {
            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${queue.name}</td>
                <td>${queue.calls}</td>
                <td>${queue.agents}</td>
                <td>${queue.maxWait}</td>
                <td>${queue.avgWait}</td>
            `;

            // 🔥 Highlight red if calls > 0
            if (queue.calls > 0) {
                tr.classList.add("queue-hot");
                triggerAlerts(queue);
            }

            queueBody.appendChild(tr);
        });
    }

    /* ===============================
       UPDATE TONE OVERRIDES LIST
       =============================== */
    function updateToneOverrides(queues) {
        const container = document.getElementById("queueToneOverrides");
        container.innerHTML = "";

        if (!queues || queues.length === 0) {
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

    /* ===============================
       ALERT TRIGGER LOGIC
       =============================== */
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

    /* ===============================
       PLAY ALERT TONE
       =============================== */
    function playTone() {
        const tone = alertToneSelect.value;

        let toneFile = "assets/soft.mp3";
        if (tone === "bright") toneFile = "assets/bright.mp3";
        if (tone === "pulse") toneFile = "assets/pulse.mp3";

        alertAudio.src = toneFile;
        alertAudio.volume = alertVolumeSlider.value / 100;
        alertAudio.currentTime = 0;
        alertAudio.play();
    }

    /* ===============================
       PLAY VOICE ALERT
       =============================== */
    function playVoice() {
        const voice = new Audio("assets/ttsAlert.mp3");
        voice.volume = alertVolumeSlider.value / 100;
        voice.play();
    }

    /* ===============================
       POPUP
       =============================== */
    function showPopup() {
        const popup = document.createElement("div");
        popup.className = "queue-alert-popup";
        popup.textContent = "🚨 Calls waiting in queue!";
        document.body.appendChild(popup);

        setTimeout(() => popup.classList.add("visible"), 50);
        setTimeout(() => {
            popup.classList.remove("visible");
            setTimeout(() => popup.remove(), 300);
        }, 1800);
    }

    /* ===============================
       BROWSER NOTIFICATION
       =============================== */
    function sendBrowserNotification(queue) {
        if (Notification.permission !== "granted") return;

        new Notification("Calls Waiting", {
            body: `Queue: ${queue.name}
Calls: ${queue.calls}
Agents: ${queue.agents}`,
            icon: "assets/VisionBank-Logo.png"
        });
    }

    /* ===============================
       ALERT HISTORY
       =============================== */
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

        if (alertHistory.length === 0) {
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

    /* ===============================
       TEST ALERT BUTTON
       =============================== */
    alertTestButton.addEventListener("click", () => {
        playTone();
        if (enableVoiceAlerts.checked) playVoice();
        showPopup();

        const testEntry = {
            time: new Date().toLocaleString(),
            calls: "TEST",
            agents: "TEST",
            tone: alertToneSelect.value,
            voice: enableVoiceAlerts.checked ? "Yes" : "No"
        };

        alertHistory.unshift(testEntry);
        renderHistory();
    });

    /* ===============================
       POLLING
       =============================== */
    fetchQueueStatus();
    setInterval(fetchQueueStatus, 6000);
});
