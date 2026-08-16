// SupplyPing — sends SMS alerts via Twilio. Mirrors the email alert path so a
// phone report and an email report both reach the right team, just on a
// different channel. Credentials live only here — never in frontend code.

import twilio from "twilio";

const FROM_NUMBER = process.env.TWILIO_SMS_FROM || "+18339175833";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    // Same honest-skip pattern as Stripe/EmailJS: report it clearly rather
    // than pretending the SMS sent.
    console.log("[SMS] Skipped — TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set.");
    return res.status(200).json({ sent: false, skipped: true, reason: "SMS not configured yet" });
  }

  try {
    const { recipients, message } = req.body || {};
    const numbers = (Array.isArray(recipients) ? recipients : [recipients])
      .filter(Boolean)
      .map((n) => String(n).trim())
      .filter((n) => /^\+?[0-9]{10,15}$/.test(n.replace(/[\s()-]/g, "")))
      .map((n) => (n.startsWith("+") ? n : `+1${n.replace(/[\s()-]/g, "")}`)); // assume US if no country code

    if (numbers.length === 0) {
      return res.status(400).json({ error: "No valid phone numbers provided." });
    }
    if (!message) {
      return res.status(400).json({ error: "No message provided." });
    }

    const client = twilio(sid, token);
    const results = await Promise.allSettled(
      numbers.map((to) =>
        client.messages.create({
          from: FROM_NUMBER,
          to,
          // Compliance footer required for A2P — matches the site's SMS
          // opt-in terms (Reply STOP / HELP).
          body: `${message}\n\nReply STOP to unsubscribe.`,
        })
      )
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results
      .map((r, i) => (r.status === "rejected" ? { to: numbers[i], error: r.reason && r.reason.message } : null))
      .filter(Boolean);

    if (failed.length) console.error("[SMS] Some sends failed:", failed);
    console.log(`[SMS] Sent ${sent}/${numbers.length}`);

    // Surface the first real Twilio error so the UI can show something
    // actionable. Code 21608 = unverified number on a trial account;
    // 21610 = recipient replied STOP; 30034 = A2P 10DLC not registered.
    let reason = null;
    if (sent === 0 && failed.length) {
      const msg = String(failed[0].error || "");
      if (/21608/.test(msg)) reason = "Twilio trial account — verify this number in Twilio first";
      else if (/21610/.test(msg)) reason = "this number replied STOP and is unsubscribed";
      else if (/30034|A2P|10DLC/i.test(msg)) reason = "A2P 10DLC registration required for business SMS";
      else if (/21606|21659/.test(msg)) reason = "sending number not enabled for SMS in Twilio";
      else reason = msg.slice(0, 120);
    }

    return res.status(200).json({ sent: sent > 0, count: sent, failed, reason });
  } catch (e) {
    console.error("[SMS] Handler error:", e && e.message);
    return res.status(500).json({ error: e && e.message ? e.message : "SMS send failed." });
  }
}
