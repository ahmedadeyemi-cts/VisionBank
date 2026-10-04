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
      window.VB_PORTAL_AUTH = data;
      document.documentElement.style.visibility = "";
      window.dispatchEvent(new CustomEvent("vb-portal-auth-ready", { detail: data }));
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