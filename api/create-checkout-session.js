// SupplyPing — creates a Stripe Checkout session for a self-serve upgrade.
//
// The Stripe secret key lives only here, in the STRIPE_SECRET_KEY environment
// variable on Vercel. It must never appear in frontend code — anyone could
// read it and charge cards or refund themselves.

import Stripe from "stripe";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("[Stripe] STRIPE_SECRET_KEY not configured");
    return res.status(500).json({
      error: "Billing isn't configured yet. Add STRIPE_SECRET_KEY in Vercel > Settings > Environment Variables, then redeploy.",
    });
  }

  try {
    const { priceId, email, businessName, facilityName } = req.body || {};
    if (!priceId) return res.status(400).json({ error: "No plan selected." });
    if (!email) return res.status(400).json({ error: "Missing account email." });

    const stripe = new Stripe(key);
    const origin =
      req.headers.origin ||
      (req.headers.host ? `https://${req.headers.host}` : "https://supplyping.com");

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      // The account email is the join key between Stripe and the Clients table,
      // so the webhook can find the right row when payment succeeds.
      client_reference_id: email,
      metadata: {
        account_email: email,
        business_name: businessName || "",
        facility_name: facilityName || "",
      },
      subscription_data: {
        metadata: { account_email: email },
      },
      allow_promotion_codes: true,
      success_url: `${origin}/?billing=success`,
      cancel_url: `${origin}/?billing=cancelled`,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("[Stripe] Checkout session failed:", e && e.message);
    return res.status(500).json({ error: e && e.message ? e.message : "Could not start checkout." });
  }
}
