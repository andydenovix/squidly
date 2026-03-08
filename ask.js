// netlify/functions/ask.js
// Handles POST requests from the Squidly frontend.
// Reads cached knowledge from Netlify Blobs, builds context, calls Claude.
// The ANTHROPIC_API_KEY environment variable is set in Netlify — never exposed to the browser.

import { getStore } from "@netlify/blobs";

const CACHE_KEY    = "squidly_knowledge_cache";
const MAX_CHARS    = 15000; // per source sent to Claude
const MODEL        = "claude-sonnet-4-20250514";
const MAX_TOKENS   = 1024;

export default async function handler(req) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let query;
  try {
    const body = await req.json();
    query = body.query?.trim();
    if (!query) throw new Error("Missing query");
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  // ── Load cached knowledge ───────────────────────────────────────────────
  let knowledgeContext = "";
  let sourcesSummary = "No sources loaded yet.";

  try {
    const store = getStore("squidly");
    const cache = await store.get(CACHE_KEY, { type: "json" });

    if (cache?.sources) {
      const ready = cache.sources.filter((s) => s.status === "ready" && s.content);
      if (ready.length > 0) {
        knowledgeContext = ready
          .map((s, i) => `### Source ${i + 1}: ${s.label}\n${s.content.slice(0, MAX_CHARS)}`)
          .join("\n\n---\n\n");
        sourcesSummary = `${ready.length} source(s) loaded (last updated: ${cache.updatedAt})`;
      }
    }
  } catch (err) {
    console.warn("[ask] Could not load cache:", err.message);
    // Continue without knowledge — Claude will say so
  }

  // ── Build system prompt ─────────────────────────────────────────────────
  const systemPrompt = `You are "Squidly", an enthusiastic and friendly blue squid assistant. Your job is to answer questions accurately using the provided knowledge sources.

Rules:
- If relevant information exists in the sources, use it and cite the source name (e.g. "According to [Source Name]…").
- If the answer isn't in the sources, say so cheerfully and offer what general help you can.
- Use markdown: **bold** key terms, bullet lists for multiple items.
- Keep answers concise (1–4 sentences unless detail is genuinely needed).
- One gentle sea pun per response maximum. Stay in character.
- Never make up facts not present in the sources.

Knowledge base status: ${sourcesSummary}
${knowledgeContext ? `\n\nKNOWLEDGE SOURCES:\n\n${knowledgeContext}` : "\n\nNo knowledge sources are currently cached. Let the user know and answer from general knowledge if possible."}`;

  // ── Call Claude ─────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "API key not configured. Set ANTHROPIC_API_KEY in Netlify environment variables." }, 500);
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude API error ${res.status}`);
    }

    const data = await res.json();
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("Empty response from Claude");

    return json({ reply: text }, 200);
  } catch (err) {
    console.error("[ask] Claude error:", err.message);
    return json({ error: err.message }, 502);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export const config = { path: "/api/ask" };
