// SupplyPing — translate worker free-text to English for supervisor alerts.
// Uses the same ANTHROPIC_API_KEY environment variable as analyze-hazard.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.error("[translate] No API key configured"); return res.status(500).json({ error: "API key not configured" }); }

  try {
    const { text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: "No text" });

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: `Translate this workplace facility issue report to English. If it is already English, return it unchanged. Respond with ONLY the translation, no quotes, no commentary:\n\n${String(text).slice(0, 600)}`
        }],
      }),
    });
    if (!resp.ok) { console.error("[translate] Anthropic API error", resp.status); return res.status(502).json({ error: "translate failed" }); }
    const data = await resp.json();
    const out = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    return res.status(200).json({ english: out || String(text) });
  } catch (e) {
    return res.status(500).json({ error: "translate failed" });
  }
}
