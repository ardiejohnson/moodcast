// Vercel serverless function — proxies MoodCast's model calls to the Anthropic
// Messages API with web search. The API key lives only in the server env var
// ANTHROPIC_API_KEY and is never exposed to the browser.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
    return;
  }

  // Vercel parses JSON bodies automatically; fall back to manual parse just in case.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { system, user } = body || {};
  if (typeof system !== "string" || typeof user !== "string") {
    res.status(400).json({ error: "Expected JSON body with string `system` and `user`." });
    return;
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system,
        messages: [{ role: "user", content: user }],
        tools: [{ type: "web_search_20260209", name: "web_search" }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      res.status(502).json({ error: "Anthropic API error " + upstream.status, detail: detail.slice(0, 500) });
      return;
    }

    const data = await upstream.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: "Proxy request failed", detail: String(err).slice(0, 300) });
  }
}
