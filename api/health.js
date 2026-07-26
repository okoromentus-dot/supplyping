// SupplyPing — lightweight deployment health check.
// Returns build info and whether the AI key is configured. Deliberately
// does NOT expose variable names, lengths, or any value detail.

export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    build: "2026-07-26-schema-aligned",
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}
