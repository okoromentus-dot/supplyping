// SupplyPing — Vapi voice-agent webhook.
//
// Turns a phone call into a facility report. Vapi posts here in two ways:
//
//   1. tool-calls / function-call  → the agent collected structured details
//      mid-call (location, issue, severity). This is the path you want: the
//      data is already parsed, so the report is as clean as a QR scan.
//
//   2. end-of-call-report          → fallback. Contains the transcript and
//      summary. Used only if no tool call arrived, so a call never produces
//      nothing at all.
//
// Configure in Vapi: Server URL = https://supplyping.com/api/vapi-webhook

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || "appOkUWfKR5sb2Br4";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const VAPI_SECRET = process.env.VAPI_WEBHOOK_SECRET || "";

// Email config. EmailJS blocks non-browser calls by default — enable
// "Allow EmailJS API for non-browser applications" in EmailJS > Account >
// Security, or these sends return 403 and the caller is told a team was
// notified when nobody was.
const EMAILJS_SERVICE = process.env.EMAILJS_SERVICE || "service_np65zh6";
const EMAILJS_TEMPLATE = process.env.EMAILJS_TEMPLATE || "template_58s7r9h";
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || "sVz8ve1fsqueZatOT";
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY || "";
const MANAGEMENT_EMAIL = "hello@supplyping.com";

// Sends the alert using the same template the app uses, so a phone report
// looks identical to a scanned one in the recipient's inbox.
async function sendAlertEmail({ recipients, issue, location, room, business, extra }) {
  const to = (recipients || []).filter(Boolean).join(", ");
  if (!to) {
    console.warn("[Vapi] No recipients — alert email skipped");
    return false;
  }
  try {
    const payload = {
      service_id: EMAILJS_SERVICE,
      template_id: EMAILJS_TEMPLATE,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        cleaning_email: to, to_email: to, email: to,
        issue: `📞 ${issue}`.slice(0, 400),
        location: location || "Phone report",
        location_name: location || "",
        room: room || "",
        stall: "",
        business: business || "",
        time: new Date().toLocaleString(),
        details: extra || "",
      },
    };
    if (EMAILJS_PRIVATE_KEY) payload.accessToken = EMAILJS_PRIVATE_KEY;

    const r = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("[Vapi] Alert email FAILED:", r.status, t.slice(0, 200));
      return false;
    }
    console.log("[Vapi] Alert email sent to:", to);
    return true;
  } catch (e) {
    console.error("[Vapi] Alert email error:", e && e.message);
    return false;
  }
}

// Writes to Airtable, dropping any column the base doesn't have rather than
// failing the whole row — same self-healing approach the frontend uses.
async function airtableWrite(table, fields) {
  if (!AIRTABLE_TOKEN) {
    console.error("[Vapi] AIRTABLE_TOKEN not set — cannot save report");
    return { ok: false, error: "not configured" };
  }
  let payload = { ...fields };
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${table}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: payload }),
    });
    if (r.ok) return { ok: true, id: (await r.json()).id };
    const err = await r.json().catch(() => ({}));
    const msg = (err.error && (err.error.message || err.error.type)) || "";
    const unknown = /Unknown field name:\s*\\?"?([^"\\]+)/i.exec(String(msg));
    if (unknown && payload[unknown[1]] !== undefined) {
      console.warn(`[Vapi] Dropping unknown column "${unknown[1]}"`);
      delete payload[unknown[1]];
      continue;
    }
    console.error("[Vapi] Airtable write failed:", r.status, msg);
    return { ok: false, error: msg };
  }
  return { ok: false, error: "too many retries" };
}

// Looks up which facility a caller belongs to. Falls back to the first client
// if only one exists, so a solo-tenant setup works without configuration.
async function resolveFacility(hint) {
  if (!AIRTABLE_TOKEN) return null;
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients?maxRecords=200`,
      { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
    );
    const d = await r.json();
    if (!r.ok || !d.records || !d.records.length) return null;
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const want = norm(hint);
    const hit = want
      ? d.records.find((rec) => {
          const f = rec.fields || {};
          return norm(f["Facility Name"]).includes(want) || norm(f["Business Name"]).includes(want);
        })
      : null;
    const rec = hit || (d.records.length === 1 ? d.records[0] : null);
    if (!rec) return null;
    const f = rec.fields || {};
    return {
      facility: f["Facility Name"] || f["Business Name"] || "",
      business: f["Business Name"] || "",
      alertEmail: f["Cleaning Team Email"] || "",
      teams: {
        safety: f["Safety Team Email"] || "",
        security: f["Security Team Email"] || "",
        maint: f["Maintenance Team Email"] || "",
        supply: f["Supplies Team Email"] || "",
      },
    };
  } catch (e) {
    console.error("[Vapi] Facility lookup failed:", e && e.message);
    return null;
  }
}

// Maps a free-text issue to the team that owns it, mirroring the app's routing.
function pickTeam(issueText) {
  const t = String(issueText || "").toLowerCase();
  if (/(spill|wet floor|slip|hazard|blocked|exit|fire|unsafe|injur)/.test(t)) return "safety";
  if (/(door|lock|badge|intruder|security|camera|alarm)/.test(t)) return "security";
  if (/(broken|leak|light|hvac|equipment|repair|machine|electrical)/.test(t)) return "maint";
  if (/(soap|towel|paper|restock|supply|supplies|empty|dispenser)/.test(t)) return "supply";
  return "clean";
}

// Demo links by vertical, texted to prospects who ask for more info.
const DEMO_LINKS = {
  facilities: "https://supplyping.com/demo-facilities/",
  warehouse: "https://supplyping.com/demo-facilities/",
  cleaning: "https://supplyping.com/demo-cleaning/",
  senior: "https://supplyping.com/demo-senior/",
  hospital: "https://supplyping.com/demo-hospital/",
  restaurant: "https://supplyping.com/demo-restaurants/",
  property: "https://supplyping.com/demo-commercial-real-estate/",
  school: "https://supplyping.com/demo-schools/",
  gym: "https://supplyping.com/demo-gyms/",
  transit: "https://supplyping.com/demo-transit/",
};

// Emails the founder when a call needs human follow-up. Uses the same EmailJS
// general template the app already uses, so there's no new service to
// configure and nothing extra to keep alive.
async function notifyFounder({ subject, heading, body }) {
  try {
    const payload = {
      service_id: EMAILJS_SERVICE,
      template_id: process.env.EMAILJS_GENERAL_TEMPLATE || "template_xgh05zq",
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        to_email: MANAGEMENT_EMAIL,
        email: MANAGEMENT_EMAIL,
        subject,
        heading,
        message: body,
        time: new Date().toLocaleString(),
      },
    };
    if (EMAILJS_PRIVATE_KEY) payload.accessToken = EMAILJS_PRIVATE_KEY;
    const r = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("[Notify] Email failed:", r.status, t.slice(0, 200));
      return false;
    }
    console.log("[Notify] Sent:", subject);
    return true;
  } catch (e) {
    console.error("[Notify] Error:", e && e.message);
    return false;
  }
}

// Texts a demo link to a caller who asked for one, via the existing SMS API.
async function textDemoLink(toNumber, vertical) {
  const link = DEMO_LINKS[String(vertical || "").toLowerCase().trim()] || DEMO_LINKS.facilities;
  const base = process.env.PUBLIC_BASE_URL || "https://supplyping.com";
  try {
    const r = await fetch(`${base}/api/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients: [toNumber],
        message: `Thanks for calling SupplyPing. Here's the 60-second demo: ${link}`,
      }),
    });
    const data = await r.json().catch(() => ({}));
    console.log("[SendInfo] SMS result:", JSON.stringify(data));
    return data;
  } catch (e) {
    console.error("[SendInfo] Failed:", e && e.message);
    return { sent: false, error: true };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Optional shared secret — set VAPI_WEBHOOK_SECRET in Vercel and add the
  // same value as a custom header in Vapi to stop anyone posting fake reports.
  if (VAPI_SECRET) {
    const provided = req.headers["x-vapi-secret"] || req.headers["x-vapi-signature"] || "";
    if (provided !== VAPI_SECRET) {
      console.warn("[Vapi] Rejected: bad or missing secret");
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  try {
    const body = req.body || {};
    const msg = body.message || body;
    const type = msg.type || "";

    const call = msg.call || body.call || {};
    const callerNumber =
      (call.customer && call.customer.number) || msg.customer?.number || "";

    let details = null;

    // ── Path 1: structured tool call (preferred) ──
    const toolCalls =
      msg.toolCalls || msg.toolCallList ||
      (msg.functionCall ? [{ function: msg.functionCall }] : []);

    if (Array.isArray(toolCalls) && toolCalls.length) {
      const fn = toolCalls[0].function || toolCalls[0];
      const fnName = String(fn.name || "").toLowerCase();
      let args = fn.arguments || fn.parameters || {};
      if (typeof args === "string") { try { args = JSON.parse(args); } catch (e) { args = {}; } }

      // ── Non-report tools, handled before the report path ──

      // Caller asked for a demo link by text.
      if (fnName === "send_info") {
        const to = args.phone || args.phone_number || args.number || callerNumber;
        const vertical = args.vertical || args.industry || "facilities";
        const sms = await textDemoLink(to, vertical);
        await notifyFounder({
          subject: `Demo link requested — ${to || "unknown number"}`,
          heading: "A caller asked for the demo link",
          body: `Number: ${to || "unknown"}\nVertical: ${vertical}\nSMS delivered: ${sms && sms.sent ? "yes" : "NO — follow up manually"}\n\nWorth a personal follow-up while it's warm.`,
        });
        return res.status(200).json({
          result: sms && sms.sent
            ? "Just sent that over — you should see it in a few seconds."
            : "I wasn't able to text that through — let me have someone follow up with you by email instead.",
        });
      }

      // Caller asked not to be contacted again. Honour this immediately.
      if (fnName === "do_not_call") {
        const to = args.phone || args.phone_number || args.number || callerNumber;
        console.log("[DoNotCall] Suppression requested for:", to);
        await notifyFounder({
          subject: `DO NOT CALL — ${to || "unknown number"}`,
          heading: "A contact asked not to be called again",
          body: `Number: ${to || "unknown"}\n\nRemove this number from every outbound list immediately, including your Vapi campaign CSVs and lead trackers. This is a legal obligation, not a preference.`,
        });
        return res.status(200).json({
          result: "Understood — I'll make sure you're not contacted again. Have a good day.",
        });
      }

      // Caller asked something the agent shouldn't answer.
      if (fnName === "flag_for_followup") {
        const phone = args.phone || args.phone_number || callerNumber || "";
        const contact = args.email || phone || "not provided";
        const question = args.question || args.summary || args.note || "(no detail captured)";

        await notifyFounder({
          subject: `Callback requested — ${contact}`,
          heading: "A caller wants a human to call them back",
          body: `Contact: ${contact}\nReason: ${question}\nCaller number: ${callerNumber || "unknown"}\n\nThey were told someone would call within 5-10 minutes — that clock is already running.`,
        });

        // The AI promises "you'll get a text" — make that literally true rather
        // than a spoken claim with nothing behind it. Best-effort: if this
        // fails, the founder email above still went out, so nothing is lost.
        let smsSent = false;
        if (phone) {
          try {
            const r = await fetch(`${process.env.PUBLIC_BASE_URL || "https://supplyping.com"}/api/send-sms`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recipients: [phone],
                message: "Thanks for calling SupplyPing — a team member will call you back within 5 to 10 minutes.",
              }),
            });
            const data = await r.json().catch(() => ({}));
            smsSent = !!(data && data.sent);
            console.log("[FlagFollowup] Caller SMS result:", JSON.stringify(data));
          } catch (e) {
            console.error("[FlagFollowup] Caller SMS failed:", e && e.message);
          }
        }

        return res.status(200).json({
          result: smsSent
            ? "Thanks — you'll get a text confirming that, and someone will call you within five to ten minutes."
            : "Thanks — I've passed that to our team, and someone will call you within five to ten minutes.",
        });
      }

      details = {
        issue: args.issue || args.problem || args.description || "",
        location: args.location || args.facility || args.site || "",
        room: args.room || args.area || args.zone || "",
        severity: args.severity || args.urgency || "",
        reporter: args.name || args.reporter || "",
      };
    }

    // ── Path 2: end-of-call fallback ──
    if (!details && (type === "end-of-call-report" || msg.summary || msg.transcript)) {
      const summary = msg.analysis?.summary || msg.summary || "";
      const transcript = msg.transcript || "";
      details = {
        issue: summary || String(transcript).slice(0, 300) || "Phone report (no details captured)",
        location: "", room: "", severity: "", reporter: "",
        transcript: String(transcript).slice(0, 5000),
      };
    }

    // Any other Vapi event (status updates, speech events) is acknowledged.
    if (!details) return res.status(200).json({ received: true, ignored: type });

    const client = await resolveFacility(details.location);
    const teamKey = pickTeam(details.issue);
    const teamEmail =
      (client && client.teams && client.teams[teamKey]) ||
      (client && client.alertEmail) || "";

    const nowIso = new Date().toISOString();

    // The dashboard scopes reports by the client's PRIMARY alert email,
    // facility name, or a known room. Storing a team address here would make
    // phone reports invisible to the client — so the primary is always stored,
    // and team routing is applied to the email recipients instead.
    const scopeEmail = (client && client.alertEmail) || teamEmail || "";
    const scopeLocation = (client && client.facility) || details.location || "Phone report";

    const detailsText = [
      details.reporter ? `Reported by: ${details.reporter}` : "",
      callerNumber ? `Caller: ${callerNumber}` : "",
      `Source: phone call via SupplyPing voice line`,
      `Routed to: ${teamKey} team`,
      details.transcript ? `\nTranscript:\n${details.transcript}` : "",
    ].filter(Boolean).join("\n");

    const write = await airtableWrite("Reports", {
      Status: `📞 ${details.issue}`.slice(0, 200),
      Location: scopeLocation,
      Room: details.room || "",
      "Reported At": nowIso,
      Severity: details.severity || "",
      Details: detailsText,
      "Cleaning Team Email": scopeEmail,
      Resolved: false,
    });

    // Notify the owning team plus the primary address, deduplicated —
    // mirroring how the app routes a scanned report.
    const recipients = Array.from(new Set([
      teamEmail,
      client && client.alertEmail,
      MANAGEMENT_EMAIL,
    ].filter(Boolean)));

    const emailed = await sendAlertEmail({
      recipients,
      issue: details.issue,
      location: scopeLocation,
      room: details.room,
      business: (client && client.business) || "",
      extra: detailsText,
    });

    console.log(
      `[Vapi] ${type || "tool-call"} -> report ${write.ok ? "saved " + write.id : "FAILED"} | team: ${teamKey} | emailed: ${emailed} | to: ${recipients.join(", ") || "none"}`
    );

    // Founder notification on every phone report. A call is a strong signal —
    // either a client is actively using the product, or something went wrong
    // enough that someone picked up a phone. Both are worth knowing about
    // the same day, not at the end of the week.
    await notifyFounder({
      subject: `Phone report — ${details.issue || "facility issue"}`.slice(0, 120),
      heading: write.ok ? "A facility issue was reported by phone" : "⚠️ Phone report FAILED to save",
      body: [
        `Issue: ${details.issue || "(none captured)"}`,
        `Location: ${scopeLocation || "(unknown)"}`,
        details.room ? `Area: ${details.room}` : "",
        `Severity: ${details.severity || "not stated"}`,
        `Routed to: ${teamKey} team`,
        `Alert emailed: ${emailed ? "yes" : "NO — follow up manually"}`,
        callerNumber ? `Caller: ${callerNumber}` : "",
        details.reporter ? `Reported by: ${details.reporter}` : "",
        !write.ok ? "\n⚠️ This did NOT save to Airtable. Log it manually." : "",
      ].filter(Boolean).join("\n"),
    });

    // Vapi reads this back to the caller when it's a tool call.
    return res.status(200).json({
      received: true,
      saved: write.ok,
      emailed,
      // Say only what actually happened. Telling a caller the team was
      // notified when the email failed is worse than saying nothing.
      result: write.ok && emailed
        ? "Thank you. Your report has been logged and the right team has been notified."
        : write.ok
        ? "Thank you. Your report has been logged. Please also let your supervisor know, as the alert may be delayed."
        : "I've noted your report, but there was a problem saving it. Please contact your supervisor directly.",
    });
  } catch (e) {
    console.error("[Vapi] Handler error:", e && e.message);
    return res.status(200).json({ received: true, error: "handled with errors" });
  }
}
