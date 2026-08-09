// SupplyPing — Stripe webhook. This is what actually marks an account as paid.
//
// Checkout returning "success" in the browser is NOT proof of payment: a user
// can hit the success URL directly, or close the tab before the charge settles.
// Stripe's webhook is the only trustworthy signal, which is why subscription
// state is written here and nowhere else.

import Stripe from "stripe";

// Signature verification needs the raw body, so Vercel's JSON parser is off.
export const config = { api: { bodyParser: false } };

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || "appOkUWfKR5sb2Br4";
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

// Finds the Clients row by account email and updates its plan fields.
async function setClientPlan(email, { plan, status, subscriptionId }) {
  if (!AIRTABLE_TOKEN || !email) {
    console.error("[Webhook] Missing AIRTABLE_TOKEN or email — cannot update plan");
    return false;
  }
  const clean = String(email).toLowerCase().trim().replace(/["\\]/g, "");
  try {
    const formula = `OR(LOWER(TRIM({Email}))="${clean}",LOWER(TRIM({Cleaning Team Email}))="${clean}")`;
    const findRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`,
      { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
    );
    const found = await findRes.json();
    if (!findRes.ok || !found.records || found.records.length === 0) {
      console.error(`[Webhook] No Clients row for "${clean}" — plan not updated`);
      return false;
    }
    const id = found.records[0].id;

    // Unknown columns are dropped one at a time so a missing field never
    // blocks the plan update itself.
    let fields = {
      Plan: plan,
      "Client Status": status,
      "Stripe Subscription ID": subscriptionId || "",
      "Paid Since": new Date().toISOString(),
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (r.ok) {
        console.log(`[Webhook] Plan updated for ${clean}: ${plan} / ${status}`);
        return true;
      }
      const err = await r.json().catch(() => ({}));
      const msg = (err.error && (err.error.message || err.error.type)) || "";
      const unknown = /Unknown field name:\s*\\?"?([^"\\]+)/i.exec(String(msg));
      if (unknown && fields[unknown[1]] !== undefined) {
        console.warn(`[Webhook] Dropping unknown column "${unknown[1]}"`);
        delete fields[unknown[1]];
        continue;
      }
      console.error("[Webhook] Airtable update failed:", r.status, msg);
      return false;
    }
    return false;
  } catch (e) {
    console.error("[Webhook] Error updating plan:", e && e.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !webhookSecret) {
    console.error("[Webhook] STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET missing");
    return res.status(500).json({ error: "Billing not configured" });
  }

  const stripe = new Stripe(key);
  let event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers["stripe-signature"];
    // Verifying the signature is what stops anyone from POSTing a fake
    // "payment succeeded" event and upgrading themselves for free.
    event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (e) {
    console.error("[Webhook] Signature verification failed:", e && e.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    const obj = event.data.object || {};
    const emailOf = (o) =>
      (o.metadata && o.metadata.account_email) ||
      o.client_reference_id ||
      o.customer_email ||
      (o.customer_details && o.customer_details.email) ||
      "";

    switch (event.type) {
      case "checkout.session.completed":
        await setClientPlan(emailOf(obj), {
          plan: "Paid",
          status: "Active",
          subscriptionId: obj.subscription || "",
        });
        break;

      case "customer.subscription.updated": {
        const active = ["active", "trialing"].includes(obj.status);
        await setClientPlan(emailOf(obj), {
          plan: active ? "Paid" : "Past Due",
          status: active ? "Active" : "Payment Issue",
          subscriptionId: obj.id || "",
        });
        break;
      }

      case "customer.subscription.deleted":
        await setClientPlan(emailOf(obj), {
          plan: "Cancelled",
          status: "Cancelled",
          subscriptionId: obj.id || "",
        });
        break;

      case "invoice.payment_failed":
        await setClientPlan(emailOf(obj), {
          plan: "Past Due",
          status: "Payment Issue",
          subscriptionId: obj.subscription || "",
        });
        break;

      default:
        // Everything else is acknowledged and ignored.
        break;
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("[Webhook] Handler error:", e && e.message);
    // 200 so Stripe doesn't retry forever on a bug that retrying won't fix.
    return res.status(200).json({ received: true, error: "handled with errors" });
  }
}
