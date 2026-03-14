// api/groq.js — Vercel Serverless Function (CommonJS)
// Proxy pour l'API Groq — résout le problème CORS

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["authorization"]?.replace("Bearer ", "").trim();
  if (!apiKey || !apiKey.startsWith("gsk_")) {
    return res.status(401).json({ error: "Clé API Groq manquante ou invalide (doit commencer par gsk_)" });
  }

  try {
    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    });

    const data = await groqResp.json();
    return res.status(groqResp.status).json(data);
  } catch (err) {
    console.error("Groq proxy error:", err);
    return res.status(500).json({ error: "Erreur proxy: " + err.message });
  }
};
