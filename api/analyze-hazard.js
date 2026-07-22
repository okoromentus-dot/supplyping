// SupplyPing — AI hazard analysis (Vercel serverless function)
// Receives a base64 photo, asks Claude vision to classify it against
// SupplyPing's categories, and returns { category, item, severity, description }.
// The API key lives in the ANTHROPIC_API_KEY environment variable on Vercel —
// never in frontend code.

const ITEMS = [
  // Safety & Hazards
  "Wet Floor / Spill", "Blocked Exit / Aisle", "Trip / Fall Hazard", "Near-Miss / Incident", "PPE / Equipment Unsafe",
  // Security & Facilities
  "Access / Door Issue", "Property Damage", "Suspicious Activity",
  // Maintenance & Repairs
  "Lighting Out / Flickering", "HVAC / Temperature Issue", "Broken Fixture / Door", "Equipment Issue",
  // Cleaning & Sanitation
  "Spill / Mess Needs Cleanup", "Restroom Needs Attention", "Trash / Bins Full",
  // Supplies
  "No Soap", "No Paper Towels", "No Toilet Paper", "No Hand Sanitizer", "Breakroom Restock",
];

export default async function handler(req, res) {
  // CORS for the frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Accept the correct name and the common typo, so a misnamed env var
  // doesn't take the feature down.
  const key = process.env.ANTHROPIC_API_KEY || process.env.ANTHROLIC_API_KEY;
  if (!key) {
    console.error("[analyze-hazard] No API key found. Env vars present:", Object.keys(process.env).filter(k => k.includes("ANTH")).join(", ") || "none matching ANTH*");
    return res.status(500).json({ error: "API key not configured in Vercel. Add ANTHROPIC_API_KEY in Project Settings → Environment Variables, then redeploy." });
  }

  try {
    const { image, mediaType } = req.body || {};
    if (!image) return res.status(400).json({ error: "No image provided" });

    const prompt = `You are a facility safety triage assistant. Look at this photo from a workplace facility and classify the issue.

Choose the single best match from this exact list of issue types:
${ITEMS.map((i) => `- ${i}`).join("\n")}

Respond with ONLY a JSON object, no other text, in this shape:
{"item": "<exact issue type from the list>", "severity": "Low" | "Medium" | "High", "description": "<one or two factual sentences describing what is visible and where the concern is. Plain language, no speculation beyond what is visible.>", "confident": true | false}

Severity guide: High = immediate injury risk or blocked emergency egress. Medium = should be addressed today. Low = routine.
If the photo does not clearly show a facility issue, set "confident": false and pick the closest plausible item.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("[analyze-hazard] Anthropic API error", resp.status, t.slice(0, 500));
      return res.status(502).json({ error: `AI request failed (${resp.status})`, detail: t.slice(0, 300) });
    }

    const data = await resp.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    // Validate against the known list; fall back safely
    if (!ITEMS.includes(parsed.item)) parsed.item = null;
    if (!["Low", "Medium", "High"].includes(parsed.severity)) parsed.severity = "Medium";
    parsed.description = String(parsed.description || "").slice(0, 400);

    return res.status(200).json(parsed);
  } catch (e) {
    console.error("[analyze-hazard] Unhandled error:", e);
    return res.status(500).json({ error: "Analysis failed", detail: String(e).slice(0, 200) });
  }
}
