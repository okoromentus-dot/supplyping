// SupplyPing — translate worker free-text to English for supervisor alerts.
// Uses the same GEMINI_API_KEY environment variable as analyze-hazard.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) { console.error("[translate] No API key configured"); return res.status(500).json({ error: "API key not configured" }); }

  try {
    const { text, target } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: "No text" });

    // Target language for the translation. Defaults to English so existing
    // callers (worker free-text -> supervisor English) keep working unchanged.
    const LANG_NAMES = { en: "English", es: "Spanish", fr: "French", ar: "Arabic", bn: "Bengali", hi: "Hindi", zh: "Simplified Chinese" };
    const targetName = LANG_NAMES[String(target || "en")] || "English";

    const resp = await fetch(
      "https://gemini.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Translate this workplace facility issue report to ${targetName}. If it is already in ${targetName}, return it unchanged. Preserve any emoji, times, and location names exactly. Respond with ONLY the translation, no quotes, no commentary:\n\n${String(text).slice(0, 600)}`
            }],
          }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.3 },
        }),
      }
    );
    if (!resp.ok) { console.error("[translate] Gemini API error", resp.status); return res.status(502).json({ error: "translate failed" }); }
    const data = await resp.json();
    const out = (((data.candidates || [])[0] || {}).content?.parts || []).map(p => p.text || "").join("").trim();
    // `english` kept for backward compatibility with existing callers;
    // `translated` is the forward-looking key.
    const value = out || String(text);
    return res.status(200).json({ english: value, translated: value, target: String(target || "en") });
  } catch (e) {
    return res.status(500).json({ error: "translate failed" });
  }
}
