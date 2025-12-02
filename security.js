/* Email was setup on https://dashboard.emailjs.com/admin/templates/4uvjpq2 */

/* =========================================
   VisionBank — Secure Admin Login + MFA
   ========================================= */

const EMAILJS_SERVICE   = "service_ftbnopr";
const EMAILJS_TEMPLATE  = "template_v8t8bzj";  // <--- IMPORTANT!!!
const EMAILJS_PUBLICKEY = "Z_4fEOdBy8J__XmyP";

emailjs.init(EMAILJS_PUBLICKEY);

// Registered admin accounts
const ADMINS = [
    { username: "superadmin", pin: "ChangeMeNow!" }
];

// MFA delivery list (up to 10 emails supported)
const MFA_EMAILS = [
    "ahmed.adeyemi@ussignal.com",
    "ahmed.adeyemi@oneneck.com",
    "ahmedadeyemi@gmail.com"
];

let MFA_CODE = null;

/* Generate 6-digit MFA code */
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/* Send MFA code using EmailJS */
async function sendMFA(username) {
    MFA_CODE = generateCode();

    try {
        await emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
            code: MFA_CODE,
            admin: username,
            recipients: MFA_EMAILS.join(", ")
        });

        console.log("MFA sent successfully.");
        return true;

    } catch (err) {
        console.error("EmailJS Error:", err);
        alert("Unable to send MFA email. Check EmailJS Template ID and Service configuration.");
        return false;
    }
}

/* Authenticate username & PIN */
function loginAdmin() {
    const user = document.getElementById("adminUser").value.trim();
    const pin  = document.getElementById("adminPin").value.trim();

    const found = ADMINS.find(a => a.username === user && a.pin === pin);

    if (!found) {
        alert("Invalid username or PIN.");
        return;
    }

    // Send MFA
    sendMFA(user).then(success => {
        if (success) {
            document.getElementById("mfaSection").style.display = "block";
            document.getElementById("loginSection").style.display = "none";
        }
    });
}

/* Verify MFA code */
function verifyCode() {
    const entered = document.getElementById("mfaInput").value.trim();

    if (entered === MFA_CODE) {
        localStorage.setItem("security-auth", "true");
        window.location.href = "security-dashboard.html";
    } else {
        alert("Invalid MFA code.");
    }
}

/* Override key */
function overrideLogin() {
    const key = document.getElementById("overrideKey").value.trim();

    if (key === "USsignalOverride2025") {
        localStorage.setItem("security-auth", "true");
        window.location.href = "security-dashboard.html";
    } else {
        alert("Invalid override key.");
    }
}
