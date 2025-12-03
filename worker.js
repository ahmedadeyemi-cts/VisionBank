import { totp } from "otplib";
import { encode } from "url-safe-base64";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Helper: JSON responses
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    // Helper: append log entry
    async function logEvent(text) {
      const ts = new Date().toISOString();
      const entry = `${ts}  |  ${text}\n`;

      await env.LOGS.put(`log-${ts}`, entry);
      return true;
    }

    // ------------------------------------------
    // 1. ADMIN LOGIN (Username + PIN)
    // ------------------------------------------
    if (path === "/api/login" && method === "POST") {
      const body = await req.json();
      const { username, pin } = body;

      const adminCred = await env.ADMIN.get("credentials", "json");

      if (!adminCred) {
        return json({ error: "Admin not initialized" }, 500);
      }

      if (adminCred.username !== username || adminCred.pin !== pin) {
        await logEvent(`FAILED LOGIN attempt from ${req.headers.get("CF-Connecting-IP")}`);
        return json({ error: "Invalid credentials" }, 401);
      }

      await logEvent(`LOGIN OK for ${username}`);

      return json({ success: true });
    }

    // ------------------------------------------
    // 2. MFA: FETCH SECRET / QR
    // ------------------------------------------
    if (path === "/api/mfa/setup" && method === "GET") {
      let secret = await env.MFA.get("secret");

      if (!secret) {
        secret = totp.generateSecret();
        await env.MFA.put("secret", secret);
      }

      const account = "VisionBank Security (superadmin)";
      const issuer = "VisionBank";

      const otpAuthURL = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}`;

      return json({
        secret,
        otpAuthURL,
        qrURL: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encode(
          otpAuthURL
        )}`,
      });
    }

    // ------------------------------------------
    // 3. MFA VERIFY (TOTP)
    // ------------------------------------------
    if (path === "/api/mfa/verify" && method === "POST") {
      const { code } = await req.json();
      const secret = await env.MFA.get("secret");

      if (!secret) return json({ error: "MFA not set up" }, 400);

      const isValid = totp.check(code, secret);

      if (!isValid) {
        await logEvent("FAILED MFA ATTEMPT");
        return json({ error: "Invalid MFA code" }, 401);
      }

      await logEvent("MFA SUCCESS");

      return json({ success: true });
    }

    // ------------------------------------------
    // 4. IP ALLOWLIST (GET)
    // ------------------------------------------
    if (path === "/api/ip" && method === "GET") {
      const stored = await env.IP_ALLOWLIST.get("allowlist", "json");
      return json(stored || []);
    }

    // ------------------------------------------
    // 5. ADD IP
    // ------------------------------------------
    if (path === "/api/ip" && method === "POST") {
      const { ip } = await req.json();
      let list = (await env.IP_ALLOWLIST.get("allowlist", "json")) || [];

      list.push(ip);

      await env.IP_ALLOWLIST.put("allowlist", JSON.stringify(list));
      await logEvent(`IP Added: ${ip}`);

      return json({ success: true, list });
    }

    // ------------------------------------------
    // 6. DELETE IP
    // ------------------------------------------
    if (path === "/api/ip" && method === "DELETE") {
      const { ip } = await req.json();

      let list = (await env.IP_ALLOWLIST.get("allowlist", "json")) || [];

      list = list.filter((x) => x !== ip);

      await env.IP_ALLOWLIST.put("allowlist", JSON.stringify(list));
      await logEvent(`IP Removed: ${ip}`);

      return json({ success: true, list });
    }

    // ------------------------------------------
    // 7. GET BUSINESS HOURS
    // ------------------------------------------
    if (path === "/api/business-hours" && method === "GET") {
      const hours = await env.BUSINESS.get("hours", "json");
      return json(hours || {});
    }

    // ------------------------------------------
    // 8. SET BUSINESS HOURS
    // ------------------------------------------
    if (path === "/api/business-hours" && method === "POST") {
      const hours = await req.json();
      await env.BUSINESS.put("hours", JSON.stringify(hours));

      await logEvent(`Business hours updated`);

      return json({ success: true });
    }

    // ------------------------------------------
    // 9. FETCH LOGS
    // ------------------------------------------
    if (path === "/api/logs" && method === "GET") {
      const logs = await env.LOGS.list();
      return json(logs.keys);
    }

    return json({ error: "Not found" }, 404);
  },
};
