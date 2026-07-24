// SupplyPing — deployment health check.
// Visit https://supplyping.com/api/health in a browser.
// Reports whether the AI key is visible to this deployment — names only,
// never values, so it is safe to expose during setup.

export default function handler(req, res) {
  const anthVars = Object.keys(process.env).filter((k) => k.toUpperCase().includes("ANTH"));
  // Forensics: expose name length + char codes and value length (never the
  // value itself) so invisible characters or empty values become visible.
  const forensics = anthVars.map((k) => ({
    name: k,
    nameLength: k.length,            // "ANTHROPIC_API_KEY" should be exactly 17
    nameCharCodes: Array.from(k).map((c) => c.charCodeAt(0)), // all should be A-Z/_ (65-90, 95)
    valueLength: (process.env[k] || "").length, // 0 means the value is EMPTY
    valueStartsWith: (process.env[k] || "").slice(0, 7), // should be "sk-ant-"
  }));
  res.status(200).json({
    ok: true,
    build: "2026-07-23-env-forensics",
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROLIC_API_KEY),
    anthropicVarNamesVisible: anthVars,
    forensics,
    hint: anthVars.length === 0
      ? "No ANTHROPIC_API_KEY visible to this deployment. Either the variable is in a different Vercel project than the one serving this domain, or it is not enabled for Production, or the deploy predates the variable."
      : "Key variable is visible. If AI still fails, the key VALUE may be invalid - check Vercel function logs.",
  });
}
