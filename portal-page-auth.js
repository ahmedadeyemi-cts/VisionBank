(function () {
  "use strict";

  const WORKER = "https://visionbank-security.ahmedadeyemi.workers.dev";
  const RETURN_KEY = "vb_return_to";

  document.documentElement.style.visibility = "hidden";

  function safeReturnPath() {
    const value = location.pathname + location.search + location.hash;
    return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
  }

  function redirectToLogin() {
    try { sessionStorage.setItem(RETURN_KEY, safeReturnPath()); } catch {}
    const target = new URL("security.html", location.href);
    location.replace(target.href);
  }

  function redirectToLicensing(reason = "license_required") {
    try { sessionStorage.setItem(RETURN_KEY, safeReturnPath()); } catch {}
    const target = new URL("security.html", location.href);
    target.searchParams.set("reason", reason);
    target.searchParams.set("view", "licensing");
    location.replace(target.href);
  }

  async function validate() {
    const session = window.VBPortalSession?.get() || "";
    if (!session) {
      redirectToLogin();
      return;
    }

    try {
      const response = await fetch(WORKER + "/api/session/status", {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: "Bearer " + session }
      });
      if (!response.ok) {
        window.VBPortalSession?.clear();
        redirectToLogin();
        return;
      }
      const data = await response.json();
      if (!data?.success || !data?.user?.email) {
        window.VBPortalSession?.clear();
        redirectToLogin();
        return;
      }
      let license = {enforcementEnabled:false,allowed:true,status:"not-enforced"};
      const licenseResponse = await fetch(WORKER + "/api/license/status", {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: "Bearer " + session }
      });
      if (licenseResponse.status === 401) {
        window.VBPortalSession?.clear();
        redirectToLogin();
        return;
      }
      if (licenseResponse.ok) {
        license = await licenseResponse.json();
        if (license?.enforcementEnabled === true && license?.allowed !== true) {
          redirectToLicensing(license.reason || license.status || "license_required");
          return;
        }
      } else if (licenseResponse.status !== 404) {
        throw new Error("license-status-unavailable");
      }

      window.VB_PORTAL_AUTH = data;
      window.VB_LICENSE = license;
      document.documentElement.style.visibility = "";
      window.dispatchEvent(new CustomEvent("vb-portal-auth-ready", { detail: {...data, license} }));
    } catch (error) {
      console.error("Portal authentication validation failed:", error);
      document.documentElement.style.visibility = "";
      const overlay = document.getElementById("access-denied-overlay");
      const message = document.getElementById("access-denied-message");
      if (message) message.textContent = "Unable to validate your VisionBank session. Please try again.";
      overlay?.classList.remove("hidden");
    }
  }

  void validate();
})();