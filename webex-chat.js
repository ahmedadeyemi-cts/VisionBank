(() => {
  "use strict";

  const CHAT_ROOT_ID = "divicw";
  const CHAT_SCRIPT_ID = "visionbank-webex-connect-livechat";
  const CHAT_SCRIPT_BASE = "https://chat-widget.produs1.ciscoccservice.com/js/imichatinit.js";
  const SECURITY_WAIT_MS = 20000;
  const SECURITY_POLL_MS = 250;

  function securityApproved() {
    return window.VB_SECURITY?.allowed === true ||
      document.body?.classList.contains("security-approved");
  }

  function removeTlsAlert() {
    const frame = document.getElementById("tls_al_frm");
    if (frame) frame.remove();
  }

  function showTlsAlert(root) {
    if (!root || document.getElementById("tls_al_frm")) return;

    root.insertAdjacentHTML(
      "afterend",
      '<iframe id="tls_al_frm" title="Live Chat browser support notice" frameborder="0" style="overflow:hidden;height:208px;width:394px;position:fixed;display:none;right:32px;bottom:24px;z-index:99999;"></iframe>'
    );

    const frame = document.getElementById("tls_al_frm");
    if (!frame?.contentWindow) return;

    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(
      "<!doctype html><html><head><meta charset='utf-8'><title>Live Chat Notice</title>" +
      "<style>body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#374151;font-size:14px}" +
      ".popover{background:#fff;padding:20px;border-radius:12px;width:320px;box-shadow:0 14px 36px rgba(15,23,42,.2);border:1px solid #d7dde3;position:relative}" +
      ".title{font-weight:700;color:#12372d;font-size:16px;padding-right:28px}.copy{margin-top:8px;line-height:1.45;color:#59636e}" +
      ".close{position:absolute;right:14px;top:12px}.close a{text-decoration:none;color:#59636e;font-size:18px}" +
      "</style></head><body><div class='popover'><div class='close'><a href='#' onclick='closeTLSAlert();return false' aria-label='Close'>×</a></div>" +
      "<div class='title'>Live Chat needs a current browser</div><div class='copy'>Please update your browser to the latest version and reopen this page to use VisionBank Live Chat.</div></div>" +
      "<script>function closeTLSAlert(){window.parent.postMessage({key:'close_tls_alert',value:'close_tls_alert',action:'close_tls_alert'},'*');}<\/script></body></html>"
    );
    doc.close();
    frame.style.display = "block";

    const handler = event => {
      if (event?.data?.action === "close_tls_alert") {
        removeTlsAlert();
        window.removeEventListener("message", handler);
      }
    };
    window.addEventListener("message", handler);
  }

  function loadCiscoLiveChat() {
    const root = document.getElementById(CHAT_ROOT_ID);
    if (!root || document.getElementById(CHAT_SCRIPT_ID)) return;

    document.body.classList.add("visionbank-livechat-enabled");

    const script = document.createElement("script");
    script.id = CHAT_SCRIPT_ID;
    script.async = true;
    script.src = `${CHAT_SCRIPT_BASE}?t=${encodeURIComponent(new Date().toISOString())}`;

    script.addEventListener("load", () => {
      document.body.classList.add("visionbank-livechat-loaded");
      console.info("[VisionBank Live Chat] Cisco Webex Connect widget loaded.");
    });

    script.addEventListener("error", () => {
      console.error("[VisionBank Live Chat] Cisco Webex Connect widget failed to load.");
      showTlsAlert(root);
    });

    root.insertAdjacentElement("afterend", script);
  }

  function init() {
    const startedAt = Date.now();

    const timer = window.setInterval(() => {
      if (securityApproved()) {
        window.clearInterval(timer);
        loadCiscoLiveChat();
        return;
      }

      if (Date.now() - startedAt >= SECURITY_WAIT_MS) {
        window.clearInterval(timer);
        console.warn("[VisionBank Live Chat] Security approval was not received; chat was not loaded.");
      }
    }, SECURITY_POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
