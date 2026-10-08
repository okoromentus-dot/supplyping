// SupplyPing — sends report alert emails through Resend (server side).
// Replaces the browser EmailJS send for report alerts. The app POSTs the same
// payload it used to hand to the EmailJS template; this route turns it into
// an email. Credentials live only here (RESEND_API_KEY), never in the browser.
//
// Any non-2xx response makes the app queue the report and retry on reconnect,
// exactly as an EmailJS failure did.

const MAX_RECIPIENTS = 10;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function clip(v, n) {
  return String(v == null ? "" : v).slice(0, n);
}

// The app sends recipients as a comma separated string in cleaning_email /
// to_email / email (same value in all three, mirroring the old template).
function parseRecipients(body) {
  const raw = [body.cleaning_email, body.to_email, body.email]
    .filter(Boolean).join(",");
  const list = raw.split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(list)).filter(e => EMAIL_RE.test(e)).slice(0, MAX_RECIPIENTS);
}

// Pull a photo link out of the dedicated field, or out of the "📷 Photo: <url>"
// segment the app appends to the issue line. Only http(s) links are used.
function findPhoto(body) {
  const direct = body.photo_url || body.photo || "";
  const fromIssue = (String(body.issue || "").match(/Photo:\s*(https?:\/\/\S+)/) || [])[1] || "";
  const url = String(direct || fromIssue).trim();
  return /^https?:\/\//i.test(url) ? url.slice(0, 2000) : "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[report-alert] RESEND_API_KEY not set");
    return res.status(500).json({ error: "Email service not configured" });
  }

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: "Invalid JSON" }); }
  }

  const to = parseRecipients(body);
  if (!to.length) return res.status(400).json({ error: "No valid recipient email" });

  const issue = clip(body.issue, 1500);
  const location = clip(body.location || body.location_name, 200);
  const room = clip(body.room, 200);
  const stall = clip(body.stall, 100);
  const business = clip(body.business, 200);
  const time = clip(body.time, 100) || new Date().toLocaleString("en-US", { timeZone: "America/Detroit" });
  const severity = clip(body.severity || (issue.match(/Severity:\s*([^—]+)/) || [])[1] || "", 50).trim();
  const description = clip(body.description || (issue.match(/Details:\s*([^—]+)/) || [])[1] || "", 1500).trim();
  const photo = findPhoto(body);

  // Headline = the first segment of the issue line (before the detail parts).
  const headline = (issue.split(" — ")[0] || "Facility issue reported").trim();
  const where = [location, room, stall].filter(Boolean).join(" · ");
  const subject = clip(`SupplyPing Alert: ${headline}${where ? " at " + where : ""}`, 150);

  const rows = [
    ["Issue", headline],
    ["Severity", severity],
    ["Description", description],
    ["Location", location],
    ["Room / Area", room],
    ["Unit", stall],
    ["Business", business],
    ["Reported", time],
    ["Sent to", to.join(", ")],
  ].filter(([, v]) => v);

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
      <p style="font-size:16px;font-weight:700;margin:0 0 12px;">${esc(headline)}</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%;">
        ${rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#666;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;">${esc(v)}</td></tr>`).join("")}
      </table>
      ${photo ? `<p style="margin:16px 0 0;"><a href="${esc(photo)}" style="color:#ea580c;font-weight:600;">View photo</a></p>
      <p style="margin:8px 0 0;"><img src="${esc(photo)}" alt="Photo of the reported issue" style="max-width:100%;border-radius:8px;" /></p>` : ""}
      <p style="font-size:11px;color:#999;margin-top:20px;">Sent by SupplyPing · supplyping.com</p>
    </div>`;

  const text = [
    headline,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    photo ? `Photo: ${photo}` : "",
    "",
    "Sent by SupplyPing · supplyping.com",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "SupplyPing Alerts <notifications@alerts.supplyping.com>",
        to,
        subject,
        html,
        text,
        headers: {
          "List-Unsubscribe": "<mailto:hello@supplyping.com?subject=unsubscribe%20report%20alerts>",
        },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("[report-alert] Resend failed:", r.status, t.slice(0, 300));
      return res.status(502).json({ error: `Email send failed (${r.status})` });
    }
    const data = await r.json().catch(() => ({}));
    console.log("[report-alert] sent:", subject, "| to:", to.join(", "));
    return res.status(200).json({ ok: true, id: data.id || null });
  } catch (e) {
    console.error("[report-alert] error:", e && e.message);
    return res.status(500).json({ error: "Email send error" });
  }
}
