/* =================================================
   VisionBank Security Dashboard Access Controller
   ================================================= */

if (localStorage.getItem("security-auth") !== "true") {
    window.location.href = "security.html";
}

/* ------------------------------
   IP Allowlist Management
--------------------------------*/
function saveIPs() {
    const raw = document.getElementById("ipList").value
        .split("\n")
        .map(x => x.trim())
        .filter(x => x.length > 0);

    localStorage.setItem("allowedIPs", JSON.stringify(raw));
    alert("IP Rules Updated!");
}

/* ------------------------------
   Business Hours
--------------------------------*/
function saveHours() {
    const start = document.getElementById("bhStart").value;
    const end   = document.getElementById("bhEnd").value;

    const days = [];
    document.querySelectorAll(".dayCheck").forEach(box => {
        if (box.checked) days.push(box.value);
    });

    const hours = { start, end, days };
    localStorage.setItem("businessHours", JSON.stringify(hours));

    alert("Business hours updated!");
}

/* ------------------------------
   Super Admin PIN Reset
--------------------------------*/
function updateAdminPin() {
    const newPin = document.getElementById("newPin").value;

    if (!newPin || newPin.length < 4) {
        alert("PIN must be at least 4 digits.");
        return;
    }

    const admins = JSON.parse(localStorage.getItem("ADMINS") || "[]");
    if (admins.length > 0) admins[0].pin = newPin;

    localStorage.setItem("ADMINS", JSON.stringify(admins));
    alert("Admin PIN updated successfully.");
}

/* ------------------------------
   Logout
--------------------------------*/
function logout() {
    localStorage.removeItem("security-auth");
    window.location.href = "security.html";
}
